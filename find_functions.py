from enum import Enum
import os
from pickle import GLOBAL
import shutil
from enum import Enum
import json
import ast
#from graph_tool.all import *
import numpy as np
import similarity
from multiprocessing import Pool
from collections import Counter
import time

#FILEPATH = "./test"
#FILEPATH = "/home/chirag/scikit-learn"
#OUTPUT_FOLDER = "./index/"

FILEPATH=''
OUTPUT_FOLDER = ''
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

BUILTIN_TYPES = [int, float, complex, list, tuple, range, str, bytes, bytearray, memoryview, set, frozenset, dict]
MODULE_BUILTINS = ['__class__', '__contains__', '__delattr__', '__delitem__', '__dir__', '__doc__', '__eq__', '__format__', '__ge__', '__getattribute__', '__getitem__', '__gt__', '__hash__', '__init__', '__init_subclass__', '__iter__', '__le__', '__len__', '__lt__', '__ne__', '__new__', '__reduce__', '__reduce_ex__', '__repr__', '__reversed__', '__setattr__', '__setitem__', '__sizeof__', '__str__', '__subclasshook__', 'clear', 'copy', 'fromkeys', 'get', 'items', 'keys', 'pop', 'popitem', 'setdefault', 'update', 'values']
GLOBAL_BUILTINS  = ['ArithmeticError', 'AssertionError', 'AttributeError', 'BaseException', 'BlockingIOError', 'BrokenPipeError', 'BufferError', 'BytesWarning', 'ChildProcessError', 'ConnectionAbortedError', 'ConnectionError', 'ConnectionRefusedError', 'ConnectionResetError', 'DeprecationWarning', 'EOFError', 'Ellipsis', 'EnvironmentError', 'Exception', 'False', 'FileExistsError', 'FileNotFoundError', 'FloatingPointError', 'FutureWarning', 'GeneratorExit', 'IOError', 'ImportError', 'ImportWarning', 'IndentationError', 'IndexError', 'InterruptedError', 'IsADirectoryError', 'KeyError', 'KeyboardInterrupt', 'LookupError', 'MemoryError', 'ModuleNotFoundError', 'NameError', 'None', 'NotADirectoryError', 'NotImplemented', 'NotImplementedError', 'OSError', 'OverflowError', 'PendingDeprecationWarning', 'PermissionError', 'ProcessLookupError', 'RecursionError', 'ReferenceError', 'ResourceWarning', 'RuntimeError', 'RuntimeWarning', 'StopAsyncIteration', 'StopIteration', 'SyntaxError', 'SyntaxWarning', 'SystemError', 'SystemExit', 'TabError', 'TimeoutError', 'True', 'TypeError', 'UnboundLocalError', 'UnicodeDecodeError', 'UnicodeEncodeError', 'UnicodeError', 'UnicodeTranslateError', 'UnicodeWarning', 'UserWarning', 'ValueError', 'Warning', 'ZeroDivisionError', '__build_class__', '__debug__', '__doc__', '__import__', '__loader__', '__name__', '__package__', '__spec__', 'abs', 'all', 'any', 'ascii', 'bin', 'bool', 'breakpoint', 'bytearray', 'bytes', 'callable', 'chr', 'classmethod', 'compile', 'complex', 'copyright', 'credits', 'delattr', 'dict', 'dir', 'divmod', 'enumerate', 'eval', 'exec', 'exit', 'filter', 'float', 'format', 'frozenset', 'getattr', 'globals', 'hasattr', 'hash', 'help', 'hex', 'id', 'input', 'int', 'isinstance', 'issubclass', 'iter', 'len', 'license', 'list', 'locals', 'map', 'max', 'memoryview', 'min', 'next', 'object', 'oct', 'open', 'ord', 'pow', 'print', 'property', 'quit', 'range', 'repr', 'reversed', 'round', 'set', 'setattr', 'slice', 'sorted', 'staticmethod', 'str', 'sum', 'super', 'tuple', 'type', 'vars', 'zip']
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

    def get_method_chain(n):
        if type(n) == ast.Call:
            return [get_fname(n)[:-1]] + get_method_chain(n.func)
        elif type(n) == ast.Attribute:
            return get_method_chain(n.value)

        return []

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

    def get_line_end(n):
        ml = n.lineno
        for ni in ast.walk(n):
            if hasattr(ni, 'lineno'):
                ml = max(ml, ni.lineno)
        return ml

    # get list of parameters from function
    def get_params(n):
        n = n.args
        out = []
        if n.posonlyargs != None:
            out += [a.arg for a in n.posonlyargs]
        if n.args != None:
            out += [a.arg for a in n.args]
        if n.kwonlyargs != None:
            out += [a.arg for a in n.kwonlyargs]
        if n.vararg != None:
            out.append(n.vararg.arg)
        if n.kwarg != None:
            out.append(n.kwarg.arg)
        return out


    # Iterate over the tree
    for n in tree:
        if type(n) == ast.FunctionDef:
            if n.name in function_def:
                function_def[n.name]['lineno'].append(n.lineno)
                function_def[n.name]['line-end'].append(get_line_end(n))
            else:
                function_def[n.name] = {
                    'calls': [],
                    'lineno': [n.lineno],
                    'line-end': [get_line_end(n)],
                    'params': get_params(n)
                }

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
            bases = [get_name(ni)[:-1] for ni in n.bases] # Get all inherited classes (for use in resolving dependencies later)
            calls = []
            for ci in ast.walk(n):            # Get all functions called (no real reason for this, just nice to have)
                if type(ci) == ast.Call:
                    calls.append(get_fname(ci))
            class_def[n.name] = {
                'lineno': n.lineno,
                'linend': get_line_end(n),
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
                function_call[fname]['chain'] = get_method_chain(n.func)
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
            if f.find(f"{imports[i]['alias']}.") == 0:
                return [i], f
        return None

    def check_builtins(f):
        for t in BUILTIN_TYPES:
            if f in dir(t):
                return t
        return None

    # Naively process some of the function calls for the simplest cases
    # Unknowns are more complex, to be handled later
    ftd = []
    fta = []
    for f in function_call:
        func_arr = f.split('.')
        if filepath == './raw/feature_selection/_sequential.py':
            print(func_arr[-1])
        if func_arr[-1] in function_def: # Function name defined locally
            function_call[f]['defined'] = ['local']
            function_call[f]['alias'] = func_arr[-1]
        elif func_arr[-1] in class_def: # Class name defined locally
            function_call[f]['defined'] = ['local']
            function_call[f]['alias'] = func_arr[-1]
        elif check_imports(f) != None: # Imported module
            function_call[f]['defined'], function_call[f]['alias'] = check_imports(f)
        elif func_arr[-1] in GLOBAL_BUILTINS or func_arr[-1] in MODULE_BUILTINS: # Builtin
            fta.append((f, func_arr[-1]))
            function_call[f]['defined'] = ['builtin']
            function_call[f]['alias'] = func_arr[-1]
            ftd.append(f)
        elif check_builtins(func_arr[-1]): # Builtin type
            fta.append((f, func_arr[-1]))
            function_call[f]['alias'] = func_arr[-1]
            function_call[f]['defined'] = [check_builtins(func_arr[-1]).__name__]
            ftd.append(f)
        else:
            function_call[f]['defined'] = []
            function_call[f]['alias'] = f
            function_call[f]['full_call'] = f
    for f, fa in fta:
        if fa in function_call:
            if 'defined' not in function_call[fa]:
                function_call[fa]['defined'] = function_call[f]['defined']
            else:
                function_call[fa]['defined'] += function_call[f]['defined']
            function_call[fa]['line_num'] += function_call[f]['line_num']
        else:
            function_call[fa] = function_call[f]
    for f in ftd:
        del function_call[f]

    # This is an init file, so we need to save what is in the module namespace
    module_defs = []
    if filepath.endswith('__init__.py'):
        for n in ast.walk(ast.parse(text)):
            if type(n) == ast.Assign:
                if len([l for l in n.targets if type(l) == ast.Name and l.id == '__all__']) != 0:
                    module_defs = [e.value for e in n.value.elts]

    output_json = {
        'FunctionDef': function_def,
        'FunctionCall': function_call,
        'Import': imports,
        'ClassDef': class_def,
        'SymDef': symbol_deps,
        'ModDef': module_defs
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

#FILEPATH = "/home/chirag/scikit-learn/sklearn/ensemble/"
#FILEPATH = "/home/chirag/scikit-learn"
#OUTPUT_FOLDER = './index'
#if os.path.exists(OUTPUT_FOLDER):
#    shutil.rmtree(OUTPUT_FOLDER)

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

#generate_index('')

def sim_mapr(i, id_to_n):
    N = len(id_to_n)
    out = []
    for j in range(i):
        out.append(0)
    out.append(1)
    s1 = id_to_n[i]
    for j in range(i+1, N):
        i = 0
        u = 0
        s2 = id_to_n[j]
        for w in s1:
            u += 1
            if w in s2:
                i += 1
        for w in s2:
            if w not in s1:
                u += 1

        out.append(i / u)
    return out

def postprocess_index(root):
    print('Postprocessing index: ', root)

    # Load the JSON blobs from filepath as a dict
    out = {}
    out_path = root
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

    # Filepath --> Node maps
    all_nodes = {}
    files = {}
    folders = {}

    # Filepath --> file content maps
    function_calls = {}
    function_defs = {}
    imports = {}
    symbols = {}
    class_defs = {}

    # Convert tree dict into node tree
    def get_nodes(curr_key, subtree, parent):
        new_node = Node()
        new_node.name = curr_key
        new_node.filepath = f"{parent.filepath}/{curr_key}"
        new_node.parent = parent
        new_node.children = {}
        new_node.children_clean = {}
        all_nodes[new_node.filepath] = new_node
        parent.children[curr_key] = new_node

        if subtree[curr_key]['node-type'] == 'folder':
            for k in subtree[curr_key]['node-content'].keys():
                get_nodes(k, subtree[curr_key]['node-content'], new_node)
            new_node.type = NodeTypes.DIRECTORY
            folders[new_node.filepath] = new_node
        else:
            new_node.type = NodeTypes.FILE
            files[new_node.filepath] = new_node
            new_node.content = subtree[curr_key]['node-content']
            function_calls[new_node.filepath] = new_node.content['FunctionCall']
            function_defs[new_node.filepath] = new_node.content['FunctionDef']
            imports[new_node.filepath] = new_node.content['Import']
            class_defs[new_node.filepath] = new_node.content['ClassDef']
            symbols[new_node.filepath] = new_node.content['SymDef']

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
        function_calls[root.filepath] = root.content['FunctionCall']
        function_defs[root.filepath] = root.content['FunctionDef']
        imports[root.filepath] = root.content['Import']
        class_defs[root.filepath] = root.content['ClassDef']
        symbols[root.filepath] = root.content['SymDef']

    # Create children_clean map to search for imports
    all_nodes[root.filepath] = root
    for nk in all_nodes:
        n = all_nodes[nk]
        for c in n.children.keys():
            n.children_clean[c.replace('_', '')] = n.children[c]

    # Convert function calls into a set
    for f in function_calls:
        for fc in function_calls[f]:
            function_calls[f][fc]['defined'] = set(function_calls[f][fc]['defined'])

    # Method to heuristically resolve where functions are defined
    def guess_definitions(f):
        # Get the initial line number of each class definition
        class_lineno_range = [(c, class_defs[f][c]['lineno']) for c in class_defs[f]]
        class_lineno_range.sort(key=lambda x: -x[1])

        # Get the initial set of defined symbols and aliases
        defined_symbol_set = set(())
        for fc in function_calls[f]:
            if not function_calls[f][fc]['defined']:
                defined_symbol_set.add(f)
        import_alias_set = {imports[f][i]['alias'] for i in imports[f]}

        # Handle function calls that have a chain with a known dependency
        for fc in function_calls[f]:
            if function_calls[f][fc]['defined']:
                if len(function_calls[f][fc]['chain']) != 0:
                    for c in function_calls[f][fc]['chain']:
                        if c in defined_symbol_set:
                            function_calls[f][fc]['defined'] = function_calls[f][c]['defined']
                            break

        # Handle function calls that start with self.
        for fc in function_calls[f]:
            if not function_calls[f][fc]['defined']:
                if len(fc.split('.')) >= 2:
                    if fc.split('.')[0] == 'self':
                        if '.'.join(f.split('.')[1:]) in defined_symbol_set: # Function defined somewhere in the file, we assume in the class
                            function_calls[f][fc]['defined'] = set(['local'])
                        else:                                                # Function not found in file, it depends on the base classes
                            for l in function_calls[f][fc]['line_num']:
                                for class_name, class_def_line in class_lineno_range:
                                    if l > class_def_line:
                                        for b in class_defs[f][class_name]['bases']: # Give all base files that are non-local
                                            if b in import_alias_set:
                                                function_calls[f][fc]['defined'].add(b)
                                        continue

        # Search strategy: BFS with memoization
        # Could use topo-sort, but would do a lot of unnecessary work
        # Handles function calls that are attributes of local variables
        # We need to keep track of what has already been evaluated to handle
        # cases where there are circular dependencies
        evaluated_dependencies = {}
        def evaluate_dependencies(sym, evaluated):
            if sym in evaluated:
                return set([])
            evaluated.add(sym)
            if fc in evaluated_dependencies:
                return evaluated_dependencies[fc]

            # If a dependency matches an import, it came from there
            for i in import_alias_set:
                if i == sym[0:len(i)]:
                    evaluated_dependencies[sym] = set([i])
                    return set([i])

            # We do not exist (bad)
            if sym not in symbols[f]:
                return set([])

            # Check dependencies
            ret = set(())
            for d in symbols[f][sym]:
                # Evaluate dependencies two ways: both straight up and as attributes
                ret = ret.union(evaluate_dependencies(d, evaluated))
                if len(d.split('.')) > 1:
                    ret = ret.union(evaluate_dependencies(d.split('.')[0], evaluated))
            evaluated_dependencies[sym] = ret

            return ret

        # Handle function calls that are attributes of local variables
        ftd = []
        for fc in function_calls[f]:
            if not function_calls[f][fc]['defined']:
                if len(f.split('.')) >= 2:
                    function_calls[f][fc]['defined'] = evaluate_dependencies(fc.split('.')[0], set(()))
                    shortened_name = '.'.join(f.split('.')[1:])
                    if shortened_name in function_calls[f] and not function_calls[f][shortened_name]['defined']:
                        nf = function_calls[f][shortened_name]
                        of = function_calls[f][fc]

                        nf['line_num'] += of['line_num']
                        nf['defined'] = of['defined']
                        ftd.append(fc)
        for fc in ftd:
            del function_calls[f][fc]

    def resolve_import_path(n, i):
        level, path = i
        orig_fp = n.filepath
        for j in range(level):
            if n.parent != None:
                n = n.parent
            else:
                return ''

        path_list = path.split('.')
        for ind, p in enumerate(path_list):
            if p.replace('_', '') in n.children_clean:
                n = n.children_clean[p.replace('_', '')]
            elif p.replace('_', '')+'.json' in n.children_clean:
                n = n.children_clean[p.replace('_', '') + '.json']
            else:
                if len(path_list) > 1 and ind == len(path_list) - 1 and n.filepath in files and n.filepath != orig_fp:
                    return n.filepath
                elif len(path_list) > 1 and ind == len(path_list) - 1 and n.filepath in folders and '__init__.json' in n.children:
                    if p in n.children['__init__.json'].content['ModDef']:
                        if p in n.children['__init__.json'].content['FunctionDef']: # Locally defined in __init__ (rare, but possible)
                            return f"{n.filepath}/__init__.json"
                        ci = [ni for ni in n.children['__init__.json'].content['Import'].keys() if ni.endswith(p)]
                        if len(ci) != 0:
                            return resolve_import_path(n.children['__init__.json'], (n.children['__init__.json'].content['Import'][ci[0]]['level'], ci[0]))
                    return ''
                else:
                    return ''
        if n.filepath != orig_fp:
            return n.filepath
        return ''

    def resolve_import_paths(f):
        start_node = files[f]
        for i in imports[f]:
            imports[f][i]['path'] = resolve_import_path(start_node, (imports[f][i]['level'], i))
        for fc in function_calls[f]:
            function_calls[f][fc]['defined'] = set([(imports[f][d]['path'] if imports[f][d]['path'] != '' else d) if d in imports[f] else d for d in function_calls[f][fc]['defined']])

    # We have no clue at all where this function is defined, try to resolve via
    # searching local imports, then global (pip) imports
    def guess_definitions_global(f):
        for fc in function_calls[f]:
            if not function_calls[f][fc]['defined']:
                found_in_import = False
                for i in imports[f]:
                    if imports[f][i]['path'] != '':
                        for fd in function_defs[imports[f][i]['path']]:
                            if fd == f or (len(fc.split('.')) > 1 and fc.split('.')[-1] == fd):
                                function_calls[f][fc]['defined'].add(imports[f][i]['path'])
                                found_in_import = True

                if not found_in_import:
                    for file_comp in files:
                        for fd in function_defs[file_comp]:
                            if fd == f:
                                function_calls[f][fc]['defined'].add(file_comp)

    for f in files:
        guess_definitions(f)

    for f in files:
        resolve_import_paths(f)

    for f in files:
        guess_definitions_global(f)

    for f in files:
        for i in imports[f]:
            if imports[f][i]['path'] == '':
                imports[f][i]['path'] = i

    for f in files:
        for fd in function_calls[f]:
            fdc = function_calls[f][fd]
            nd = []
            for d in fdc['defined']:
                if d == 'local':
                    nd.append(files[f].filepath)
                elif d == 'builtin':
                    nd.append('builtin')
                elif d in imports[f]:
                    nd.append(imports[f][d]['path'])
                else:
                    nd.append(d)
            fdc['defined'] = nd

    for f in files:
        for fd in function_defs[f]:
            function_defs[f][fd]['calls'] = set(function_defs[f][fd]['calls'])

    for f in files:
        for fc in function_calls[f]:
            ln = function_calls[f][fc]['line_num']
            for l in ln:
                for fd in function_defs[f]:
                    for s, e in zip(function_defs[f][fd]['lineno'], function_defs[f][fd]['line-end']):
                        if l >= s and l <= e:
                            for d in function_calls[f][fc]['defined']:
                                function_defs[f][fd]['calls'].add(f"{d}|{function_calls[f][fc]['alias']}")

    for f in files:
        for fd in function_defs[f]:
            function_defs[f][fd]['calls'] = list(function_defs[f][fd]['calls'])

    def ci(i, d):
        for ii in i:
            if i[ii]['alias'] == d:
                return i[ii]['path']
        return d

    for f in files:
        for fc in function_calls[f]:
            function_calls[f][fc]['defined'] = set([ci(imports[f], d) for d in function_calls[f][fc]['defined']])

    other_calls = {}
    for f in files:
        for fc in function_calls[f]:
            for d in function_calls[f][fc]['defined']:
                if f"${d}|{fc}" not in other_calls:
                    other_calls[f"${d}|{fc}"] = set()
                other_calls[f"${d}|{fc}"].add(f)
    for c in other_calls:
        other_calls[c] = list(other_calls[c])
    for f in files:
        for fc in function_calls[f]:
            function_calls[f][fc]['other-calls'] = set()
            for d in function_calls[f][fc]['defined']:
                for o in other_calls[f"${d}|{fc}"]:
                    function_calls[f][fc]['other-calls'].add(o)
            if f in function_calls[f][fc]['other-calls']:
                function_calls[f][fc]['other-calls'].remove(f)
            function_calls[f][fc]['other-calls'] = list(function_calls[f][fc]['other-calls'])
            #if len(function_calls[f][fc]['other-calls']) > 5:
            #    function_calls[f][fc]['other-calls'] = function_calls[f][fc]['other-calls'][0:5]
        for fd in function_defs[f]:
            function_defs[f][fd]['other-calls'] = other_calls[f"${f}|{fd}"] if f"${f}|{fd}" in other_calls else []
            #if len(function_defs[f][fd]['other-calls']) > 5:
            #    function_defs[f][fd]['other-calls'] = function_defs[f][fd]['other-calls'][0:5]
        for cd in class_defs[f]:
            class_defs[f][cd]['other-calls'] = other_calls[f"${f}|{cd}"] if f"${f}|{cd}" in other_calls else []
            #if len(class_defs[f][cd]['other-calls']) > 5:
            #    class_defs[f][cd]['other-calls'] = class_defs[f][cd]['other-calls'][0:5]

    # g = Graph()
    # f_to_v = {}
    id_to_f = []
    f_to_id = {}
    id = 0
    for f in files:
        for fd in function_defs[f]:
            if f"{files[f].filepath}|{fd}" not in f_to_id:
                #v = g.add_vertex()
                # f_to_v[f"{files[f].filepath}|{fd}"] = v
                f_to_id[f"{files[f].filepath}|{fd}"] = id
                id_to_f.append(f"{files[f].filepath}|{fd}")
                id += 1
            for c in set(function_defs[f][fd]['calls']): # TODO: FIX!!!
                if c not in f_to_id:
                    #v = g.add_vertex()
                    # f_to_v[c] = v
                    f_to_id[c] = id
                    id_to_f.append(c)
                    id += 1
        for fc in function_calls[f]:
            if not function_calls[f][fc]['defined']:
                f_to_id[f"${files[f].filepath}|${fc}"] = id
                id_to_f.append(f"${files[f].filepath}|${fc}")
                id += 1
            else:
                for d in function_calls[f][fc]['defined']:
                    if f"${d}|${fc}" not in f_to_id:
                        f_to_id[f"${d}|${fc}"] = id
                        id_to_f.append(f"${d}|${fc}")
                        id += 1

    # Compute similiarity metrics
    fname_mat = np.identity(id)

    '''
    id_to_nlist = []
    for i in range(id):
        id_to_nlist.append(id_to_f[i].split('|')[1].split('_'))
    with Pool(8) as p:
        fname_mat = np.asarray(p.starmap(sim_mapr, [(i, id_to_nlist) for i in range(id)]))
    fname_mat = fname_mat + fname_mat.transpose() - np.identity(id)
    '''
    sim_mat = fname_mat
    '''
    adj_mat = np.identity(id)

    for f in files:
        for fd in files[f].content['FunctionDef']:
            for c in set(files[f].content['FunctionDef'][fd]['calls']):
                g.add_edge(f_to_v[f"{files[f].filepath}|{fd}"], f_to_v[c])
                adj_mat[f_to_id[f"{files[f].filepath}|{fd}"]][f_to_id[c]] = 1

    pr = pagerank(g)
    prl = [(f, pr[f_to_v[f]]) for f in f_to_v]
    prl.sort(key=lambda x: -1*x[1])
    print('Most important functions: ', [p[0].split('|')[1] for p in prl[0:10]])


    simrank.simrank(adj_mat, id)
    '''
    #sim = vertex_similarity(g)
    #siml = [(f, sim[f_to_v[f]]) for f in f_to_v]
    #print(siml)

    '''
    for f in files:
        for fd in files[f].content['FunctionDef']:
            for c in set(files[f].content['FunctionDef'][fd]['calls']):
                print(f_to_id[f"{files[f].filepath}/{fd}"], c)
                g.add_edge(f_to_id[f"{files[f].filepath}/{fd}"], c)
    '''

    '''
    G = nx.Graph()
    G.add_nodes_from(range(id))

    for f in files:
        for fd in files[f].content['FunctionDef']:
            for c in set(files[f].content['FunctionDef'][fd]['calls']):
                G.add_edge(f_to_id[f"{files[f].filepath}/{fd}"], c)

    print('Graph node count: ', G.number_of_nodes())
    print('Graph edge count: ', G.number_of_edges())
    print('Graph connected components', len(list(nx.connected_components(G))))

    for f1 in f_to_id.keys():
        for f2 in f_to_id.keys():
            if f1 != f2:
                print(f1, f2, nx.simrank_similarity(G, f_to_id[f1], f_to_id[f2], tolerance=0.01))
    '''

    # Convert back to list (to be JSON serializable)
    for f in files:
        for fc in function_calls[f]:
            function_calls[f][fc]['defined'] = list(function_calls[f][fc]['defined'])

    # Write back to nodes
    for f in files:
        node = files[f]
        node.content['FunctionCall'] = function_calls[f]
        node.content['FunctionDef'] = function_defs[f]
        node.content['Import'] = imports[f]
        node.content['ClassDef'] = class_defs[f]
        node.content['SymDef'] = symbols[f]

    np.save(os.path.join(out_path, 'sim_mat'), sim_mat)
    with open(os.path.join(out_path, 'file_key.txt'), 'w') as of:
        of.write(json.dumps({"id-to-f": id_to_f, "f-to-id": f_to_id}))

    for f in files:
        with open(os.path.join(out_path, f), 'w') as of:
            of.write(json.dumps(files[f].content))
    print('Postprocessing complete: 👍hci')

#postprocess_index(OUTPUT_FOLDER)