from enum import Enum
import os
import shutil
from enum import Enum
from tokenize import Token

FILEPATH = "/home/chirag/mana"
OUTPUT_FOLDER = "./index/"

class ParseState(Enum):
    NONE = 0

class TokenType(Enum):
    LINE_COMMENT_START = 0
    BLOCK_COMMENT_START = 1
    BLOCK_COMMENT_END = 2
    MACRO_DEFINITION_SPACE = 3
    MACRO_DEFINITION_NOSPACE = 4

if os.path.exists(OUTPUT_FOLDER):
    shutil.rmtree(OUTPUT_FOLDER)

def parse_file(filepath):
    macros = {}
    fcalls = []
    fdefs = []
    text = ''
    with open(filepath, 'r') as f:
        text = f.readlines()

    curr_state = ParseState.NONE
    for i, l in enumerate(text):
        line_tokens = [
            (l.find('//'), TokenType.LINE_COMMENT_START),
            (l.find('/*'), TokenType.BLOCK_COMMENT_START),
            (l.find('*/'), TokenType.BLOCK_COMMENT_END),
            (l.find('#define'), TokenType.MACRO_DEFINITION_NOSPACE),
            (l.find('# define'), TokenType.MACRO_DEFINITION_SPACE)
        ]
        line_tokens.sort(key=lambda x: x[0])
        line_tokens = [t for t in line_tokens if not t[0] == -1]

        def handle_line(l, line_tokens):
            nonlocal curr_state
            nonlocal macros

            if not line_tokens:
                return

            if line_tokens[0][1] == TokenType.LINE_COMMENT_START:
                return
            elif line_tokens[0][1] == TokenType.MACRO_DEFINITION_NOSPACE or \
                line_tokens[0][1] == TokenType.MACRO_DEFINITION_SPACE:
                if line_tokens[0][1] == TokenType.MACRO_DEFINITION_NOSPACE:
                    tl = l.split()[1]
                else:
                    tl = l.split()[2]
                macros[tl] = i
                l = l[l.find(tl):]

            line_tokens = line_tokens[1:]
            handle_line(l, line_tokens)

        handle_line(l, line_tokens)

    return str(macros)

def parse_all(fp):
    for o in os.listdir(os.path.join(FILEPATH, fp)):
        if os.path.isfile(os.path.join(os.path.join(FILEPATH, fp), o)):
            if len(o.split('.')) >= 2 and o.split('.')[1] in ['h', 'c', 'cpp']:
                os.makedirs(os.path.join(OUTPUT_FOLDER, fp), exist_ok=True)
                new_fname = f"{o.split('.')[0]}-{o.split('.')[1]}.txt"
                with open(os.path.join(os.path.join(OUTPUT_FOLDER, fp), new_fname), "w") as f:
                    f.write(parse_file(os.path.join(os.path.join(FILEPATH, fp), o)))
        else:
            parse_all(os.path.join(fp, o))

parse_all('')