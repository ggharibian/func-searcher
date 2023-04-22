from enum import Enum
from fnmatch import fnmatchcase
import os
from re import search
import shutil
from enum import Enum
import json
import ast
from collections import deque

from old import OUTPUT_FOLDER

#FILEPATH = "./test"
#FILEPATH = "/home/chirag/scikit-learn"
#OUTPUT_FOLDER = "./index/"

# Helper method to prettify AST Outputs
def prettify(ast_tree_str, indent=4):
    ret = []
    stack = []
    in_string = False
    curr_indent = 0
    out = ''

    for i in range(len(ast_tree_str)):
        char = ast_tree_str[i]
        if in_string and char != '\'' and char != '"':
            ret.append(char)
        elif char == '(' or char == '[':
            ret.append(char)

            if i < len(ast_tree_str) - 1:
                next_char = ast_tree_str[i+1]
                if next_char == ')' or next_char == ']':
                    curr_indent += indent
                    stack.append(char)
                    continue

            out += ''.join(ret) + '\n'
            ret.clear()

            curr_indent += indent
            ret.append(' ' * curr_indent)
            stack.append(char)
        elif char == ',':
            ret.append(char)

            out += ''.join(ret) + '\n'
            ret.clear()
            ret.append(' ' * curr_indent)
        elif char == ')' or char == ']':
            ret.append(char)
            curr_indent -= indent
            stack.pop()
        elif char == '\'' or char == '"':

            if (len(ret) > 0 and ret[-1] == '\\') or (in_string and stack[-1] != char):
                ret.append(char)
                continue

            if len(stack) > 0 and stack[-1] == char:
                ret.append(char)
                in_string = False
                stack.pop()
                continue

            in_string = True
            ret.append(char)
            stack.append(char)
        elif char == ' ':
            pass
        else:
            ret.append(char)

    out += ''.join(ret) + '\n'
    return out

# Parse a file
# This is the first pass only (find all attributes)
# Most dependencies will be resolved later
def parse_file(filepath):
    function_def = {}
    function_call = {}
    class_def = {}
    imports = {}
    symbol_deps = {}

    with open(filepath, 'r') as f:
        text = ''.join(f.readlines())

    tree = ast.walk(ast.parse(text))

    def get_name(cn):
        name = ''
        while type(cn) == ast.Attribute:
            name = f"{cn.attr}.{name}"
            cn = cn.value

        if type(cn) == ast.Name:
            name = f"{cn.id}.{name}"

        return name

    # Helper method to get fully qualified function call from a call (extracts attributes)
    def get_fname(n):
        return get_name(n.func)

    # Gets function call, including any functions that are called as part of the function call
    def get_fname_fully_qual(n):
        if type(n) == ast.Name:
            return n.id
        elif type(n) == ast.Attribute:
            return get_fname_fully_qual(n.value)+'.'+n.attr
        elif type(n) == ast.Call:
            return get_fname_fully_qual(n.func)

        return ''

    # Helper method to get all dependencies of a node (whether symbolic, import, or function)
    def get_dependencies(v):
        if v == None:
            return []

        if type(v) == ast.Constant or type(v) == ast.Compare or type(v) == ast.BoolOp:
            return []
        elif type(v) == ast.Name:
            return [v.id]
        elif type(v) == ast.Attribute or type(v) == ast.Subscript or type(v) == ast.FormattedValue or type(v) == ast.Starred:
            return get_dependencies(v.value)
        elif type(v) == ast.Call:
            return [get_fname_fully_qual(v.func)]
        elif type(v) == ast.BinOp:
            return get_dependencies(v.left) + get_dependencies(v.right)
        elif type(v) == ast.UnaryOp:
            return get_dependencies(v.operand)
        elif type(v) == ast.IfExp:
            return get_dependencies(v.body) + get_dependencies(v.orelse)
        elif type(v) == ast.Lambda:
            return get_dependencies(v.body)
        elif type(v) == ast.JoinedStr:
            out = []
            for vi in v.values:
                out += get_dependencies(vi)
            return out
        elif type(v) == ast.comprehension:
            return get_dependencies(v.iter)
        elif type(v) == ast.ListComp or type(v) == ast.GeneratorExp or type(v) == ast.SetComp:
            return get_dependencies(v.elt) + get_dependencies(v.generators[-1])
        elif type(v) == ast.Dict:
            out = []
            for vi in v.keys:
                out += get_dependencies(vi)
            for vi in v.values:
                out += get_dependencies(vi)
            return out
        elif type(v) == ast.DictComp:
            return get_dependencies(v.key) + get_dependencies(v.value) + get_dependencies(v.generators[-1])
        elif type(v) == ast.List or type(v) == ast.Tuple or type(v) == ast.Set:
            out = []
            for vi in v.elts:
                out += get_dependencies(vi)
            return out

        return []

    # Helper method to give each target of an assignment the dependencies of type d
    def assign_types(t, d):
        nonlocal symbol_deps
        if type(t) == ast.Name:
            symbol_deps[t.id] = d
        elif type(t) == ast.Tuple or type(t) == ast.List:
            for ti in t.elts:
                assign_types(ti, d)
        elif type(t) == ast.Attribute or type(t) == ast.Subscript or type(t) == ast.Starred:
            assign_types(t.value, d)
        elif type(t) == str:
            symbol_deps[t] = d
        # There are also calls, but it makes no sense at all: why would we assign to a call result???

    # Iterate over the tree
    for n in tree:
        if type(n) == ast.FunctionDef:
            function_def[n.name] = n.lineno
        elif type(n) == ast.Import:
            for a in n.names:
                imports[f"{a.name}"] = {
                    'lineno': n.lineno,
                    'alias': a.asname if a.asname != None else a.name,
                    'level': 0
                }
        elif type(n) == ast.ImportFrom:
            for a in n.names:
                imports[f"{n.module}.{a.name}"]  = {
                    'lineno': n.lineno,
                    'alias': a.asname if a.asname != None else f"{a.name}",
                    'level': n.level
                }
        elif type(n) == ast.ClassDef:
            bases = [ni.id for ni in get_name(n.bases)[:-1]] # Get all inherited classes (for use in resolving dependencies later)
            calls = []
            for ci in ast.walk(n):            # Get all functions called (no real reason for this, just nice to have)
                if type(ci) == ast.Call:
                    calls.append(get_fname(ci))
            class_def[n.name] = {
                'lineno': n.lineno,
                'bases': bases,
                'calls': [*set(calls)]
            }
        elif type(n) == ast.Call:           # Function call: get full name and save lineno
            fname = get_fname(n)
            if fname != '':
                fname = fname[:-1]
                if not fname in function_call:
                    function_call[fname] = {}
                    function_call[fname]['line_num'] = [n.lineno]
                else:
                    function_call[fname]['line_num'].append(n.lineno)
        elif type(n) == ast.Assign:
            v = get_dependencies(n.value)
            for t in n.targets:
                assign_types(t, v)
        elif type(n) == ast.AnnAssign:
            v = get_dependencies(n.value)
            assign_types(n.target, v)
        elif type(n) == ast.For:
            v = get_dependencies(n.iter)
            assign_types(n.target, v)

    def check_imports(f):
        for i in imports:
            if f.find(imports[i]['alias']) == 0:
                return i, f
        return None

    # Naively process some of the function calls for the simplest cases
    # Unknowns are more complex, to be handled later
    for f in function_call:
        func_arr = f.split('.')
        if func_arr[-1] in function_def: # Function name defined locally
            function_call[f]['defined'] = 'local'
            function_call[f]['alias'] = func_arr[-1]
        elif func_arr[-1] in class_def: # Class name defined locally
            function_call[f]['defined'] = 'local'
            function_call[f]['alias'] = func_arr[-1]
        elif func_arr[-1] in dir(__builtins__): # Builtin
            function_call[f]['defined'] = 'builtin'
            function_call[f]['alias'] = func_arr[-1]
        elif check_imports(f) != None: # Imported module
            function_call[f]['defined'], function_call[f]['alias'] = check_imports(f)
        else:
            function_call[f]['defined'] = 'unknown'
            function_call[f]['alias'] = f
            function_call[f]['full_call'] = f

    output_json = {
        'FunctionDef': function_def,
        'FunctionCall': function_call,
        'Import': imports,
        'ClassDef': class_def,
        'SymDef': symbol_deps
    }

    #return prettify(ast.dump(ast.parse(text)))
    return json.dumps(output_json)

class NodeTypes(Enum):
    FILE = 0
    DIRECTORY = 1

class Node:
    parent = None
    type = NodeTypes.FILE
    name = ''
    filepath = ''
    children = {}
    children_clean = {}
    content = {}

#FILEPATH = "/home/chirag/scikit-learn/asv_benchmarks/"
FILEPATH = "/home/chirag/scikit-learn/"
OUTPUT_FOLDER = './index'
if os.path.exists(OUTPUT_FOLDER):
        shutil.rmtree(OUTPUT_FOLDER)

def generate_index(fp):
    for o in os.listdir(os.path.join(FILEPATH, fp)):
        if os.path.isfile(os.path.join(os.path.join(FILEPATH, fp), o)):
            if len(o.split('.')) >= 2 and o.split('.')[1] in ['py']:
                os.makedirs(os.path.join(OUTPUT_FOLDER, fp), exist_ok=True)
                new_fname = f"{o.split('.')[0]}.json"
                with open(os.path.join(os.path.join(OUTPUT_FOLDER, fp), new_fname), "w") as f:
                    f.write(parse_file(os.path.join(os.path.join(FILEPATH, fp), o)))
        else:
            generate_index(os.path.join(fp, o))

generate_index('')

def guess_unknown_function_calls(root):
    out = {}
    def generate_index(fp, do):
        for o in os.listdir(os.path.join(root, fp)):
            if os.path.isfile(os.path.join(os.path.join(root, fp), o)):
                with open(os.path.join(os.path.join(root, fp), o)) as f:
                    p1 = os.path.join(fp, o)
                    p2 = json.loads(f.read())
                    do[o] = {
                        'file-name': o,
                        'file-path': p1,
                        'node-type': 'file',
                        'node-content': p2
                    }
            else:
                p1 = os.path.join(fp, o)
                do[o] = {
                    'file-name': o,
                    'file-path': p1,
                    'node-type': 'folder',
                    'node-content': {}
                }
                generate_index(os.path.join(fp, o), do[o]['node-content'])

    generate_index('', out)

    all_nodes = {}
    files = {}
    folders = {}
    def get_nodes(curr_key, subtree, parent):
        new_node = Node()
        new_node.name = curr_key
        new_node.filepath = f"{parent.filepath}/{curr_key}"

        if subtree[curr_key]['node-type'] == 'folder':
            for k in subtree[curr_key]['node-content'].keys():
                get_nodes(k, subtree[curr_key]['node-content'], new_node)
            new_node.type = NodeTypes.DIRECTORY
            folders[new_node.filepath] = new_node
        else:
            new_node.type = NodeTypes.FILE
            files[new_node.filepath] = new_node
            new_node.content = subtree[curr_key]['node-content']
        all_nodes[new_node.filepath] = new_node

    root = Node()
    root.name = list(out.keys())[0]
    root.filepath = list(out.keys())[0]
    if out[root.name]['node-type'] == 'folder':
        for k in out[root.name]['node-content'].keys():
            get_nodes(k, out[root.name]['node-content'], root)
        root.type = NodeTypes.DIRECTORY
        folders[root.filepath] = root
    else:
        root.type = NodeTypes.FILE
        files[root.filepath] = root
        root.content = out[root.name]['node-content']

    all_nodes[root.filepath] = root

    # Method to heuristically resolve where functions are defined
    def guess_definitions(fc):
        # Get the initial line number of each class definition
        class_lineno_range = [(c, fc['ClassDef'][c]['lineno']) for c in fc['ClassDef']]
        class_lineno_range.sort(key=lambda x: -x[1])

        # Get the initial set of defined symbols and aliases
        defined_symbol_set = set(())
        for f in fc['FunctionCall']:
            if fc['FunctionCall'][f]['defined'] != 'unknown':
                defined_symbol_set.add(f)
        import_alias_set = {fc['Import'][i]['alias'] for i in fc['Import']}

        # Convert defined into set
        for f in fc['FunctionCall']:
            if fc['FunctionCall'][f]['defined'] != 'unknown':
                d = fc['FunctionCall'][f]['defined']
                fc['FunctionCall'][f]['defined'] = set([fc['FunctionCall'][f]['defined']])

        # Handle function calls that start with self.
        for f in fc['FunctionCall']:
            if fc['FunctionCall'][f]['defined'] == 'unknown':
                if len(f.split('.')) >= 2:
                    if f.split('.')[0] == 'self':
                        if '.'.join(f.split('.')[1:]) in defined_symbol_set: # Function defined somewhere in the file, we assume in the class
                            fc['FunctionCall'][f]['defined'] = set(['local'])
                        else:                                                # Function not found in file, it depends on the base classes
                            fc['FunctionCall'][f]['defined'] = set()
                            for l in fc['FunctionCall'][f]['line_num']:
                                for class_name, class_def_line in class_lineno_range:
                                    if l > class_def_line:
                                        for b in fc['ClassDef'][class_name]['bases']: # Give all base files that are non-local
                                            if b in import_alias_set:
                                                fc['FunctionCall'][f]['defined'].add(b)
                                        continue

        # Search strategy: BFS with memoization
        # Could use topo-sort, but would do a lot of unnecessary work
        # Handles function calls that are attributes of local variables
        evaluated_dependencies = {}
        def evaluate_dependencies(sym):
            if f in evaluated_dependencies:
                return evaluated_dependencies[f]

            # If a dependency matches an import, it came from there
            for i in import_alias_set:
                if i == sym[0:len(i)]:
                    evaluated_dependencies[sym] = set([i])
                    return set([i])

            # We do not exist (bad)
            if sym not in fc['SymDef']:
                return set([])

            # Check dependencies
            ret = set(())
            for d in fc['SymDef'][sym]:
                # Evaluate dependencies two ways: both straight up and as attributes
                ret = ret.union(evaluate_dependencies(d))
                if len(d.split('.')) != 0:
                    ret = ret.union(evaluate_dependencies(d.split('.')[0]))
            evaluated_dependencies[sym] = ret

            return ret

        # Handle function calls that are attributes of local variables
        for f in fc['FunctionCall']:
            if fc['FunctionCall'][f]['defined'] == 'unknown':
                if len(f.split('.')) >= 2:
                    fc['FunctionCall'][f]['defined'] = evaluate_dependencies(f.split('.')[0])

        # Handle the remaining function calls
        for f in fc['FunctionCall']:
            if fc['FunctionCall'][f]['defined'] == 'unknown':
                print(f)

    for f in files:
        if f == 'benchmarks/common.json':
            guess_definitions(files[f].content)

guess_unknown_function_calls(OUTPUT_FOLDER)
