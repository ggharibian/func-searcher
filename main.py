import os
import shutil
import json

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

import find_functions
import similarity

OUTPUT_FOLDER_PROCESSED = "./index/"
OUTPUT_FOLDER_RAW = "./raw/"

app = Flask(__name__)
CORS(app)

@app.route("/index.html")
@app.route("/")
def index_html():
    return send_from_directory('static/html', 'index.html')

@app.route("/main.js")
def main_js():
    return send_from_directory('static/script', 'main.js')

@app.route("/main.css")
def main_css():
    return send_from_directory('static/styles', 'main.css')

@app.route("/graph.html")
def graph_html():
    return send_from_directory('static/html', 'graph.html')

@app.route("/graph.js")
def graph_js():
    return send_from_directory('static/script', 'graph.js')

@app.route("/graph.css")
def graph_css():
    return send_from_directory('static/styles', 'graph.css')

@app.route("/prism.js")
def prism_js():
    return send_from_directory('static/script', 'prism.js')

@app.route("/prism.css")
def prism_css():
    return send_from_directory('static/styles', 'prism.css')

@app.route("/background.png")
def background_img():
    return send_from_directory('static/assets', 'background.png')

@app.route("/reset", methods=['POST'])
def reset_files():
    if os.path.exists(OUTPUT_FOLDER_PROCESSED):
        shutil.rmtree(OUTPUT_FOLDER_PROCESSED)
    if os.path.exists(OUTPUT_FOLDER_RAW):
        shutil.rmtree(OUTPUT_FOLDER_RAW)
    return ''

@app.route("/src", methods=['POST'])
def process_file():
    filepath = '/'.join(request.files['file'].filename.split('/')[:-1])
    os.makedirs(os.path.join(OUTPUT_FOLDER_RAW, filepath), exist_ok=True)
    os.makedirs(os.path.join(OUTPUT_FOLDER_PROCESSED, filepath), exist_ok=True)
    request.files['file'].save(os.path.join(OUTPUT_FOLDER_RAW, request.files['file'].filename))

    llname = request.files['file'].filename.split('/')[-1]
    if len(llname.split('.')) >= 2 and llname.split('.')[1] == 'py':
        new_fname = f"{filepath}/{llname.split('.')[0]}.json"
        with open(os.path.join(OUTPUT_FOLDER_PROCESSED, new_fname), "w") as f:
            f.write(find_functions.parse_file(os.path.join(OUTPUT_FOLDER_RAW, request.files['file'].filename)))

    return ''

@app.route("/postprocess", methods=['POST'])
def postprocess_files():
    find_functions.postprocess_index(OUTPUT_FOLDER_PROCESSED)

    return ''

@app.route("/files", methods=["GET"])
def get_files():
    out = {}

    def generate_index(fp, do):
        for o in os.listdir(os.path.join(OUTPUT_FOLDER_PROCESSED, fp)):
            if os.path.isfile(os.path.join(os.path.join(OUTPUT_FOLDER_PROCESSED, fp), o)) and o.endswith('.json'):
                with open(os.path.join(os.path.join(OUTPUT_FOLDER_PROCESSED, fp), o)) as f:
                    p1 = os.path.join(fp, o)
                    p2 = json.loads(f.readline())
                    do[o] = {
                        'file-name': o,
                        'file-path': p1,
                        'node-type': 'file',
                        'node-content': p2
                    }
            elif os.path.isdir(os.path.join(os.path.join(OUTPUT_FOLDER_PROCESSED, fp), o)):
                p1 = os.path.join(fp, o)
                do[o] = {
                    'file-name': o,
                    'file-path': p1,
                    'node-type': 'folder',
                    'node-content': {}
                }
                generate_index(os.path.join(fp, o), do[o]['node-content'])

    generate_index('', out)

    return out

@app.route("/similar", methods=["GET"])
def get_similar_functions():
    return similarity.get_similarity(OUTPUT_FOLDER_PROCESSED, f"{request.args['file']}|{request.args['function']}")

@app.route("/raw", methods=["GET"])
def get_file():
    return send_from_directory(OUTPUT_FOLDER_RAW, request.args['fpath'])

if __name__ == "__main__":
    app.run(host='0.0.0.0')
