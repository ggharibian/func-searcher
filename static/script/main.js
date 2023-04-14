
const NodeTypes = {
    File: 0,
    Directory: 1
}

class FileNode {
    parent = undefined;
    type = undefined;
    filename = '';
    filepath = '';
    children = {};
    children_clean = {};
    content = undefined;
    dependencies = [];
    dependents = [];
}
function onFolderSelect() {
    let req = new XMLHttpRequest();
    req.onreadystatechange = function () {
        if (req.readyState == 4 && req.status == 200) {
            Array.from(document.getElementById('ctrl').files).forEach(e => {
                let r = new XMLHttpRequest();
                let formData = new FormData();

                formData.append("file", e);
                r.open("POST", 'http://localhost:5000/src');
                r.send(formData);
            });
        }
    }
    req.open('POST', 'http://localhost:5000/reset');
    req.send();
}

function getNodes(curr_node_key, subtree, node_dict, parent) {
    let new_node = new FileNode();
    new_node.filepath = subtree[curr_node_key]['file-path'];
    new_node.filename = subtree[curr_node_key]['file-name'];
    new_node.parent = parent;
    parent.children[new_node.filename] = new_node;
    parent.children_clean[new_node.filename.replace('_')] = new_node;
    if (subtree[curr_node_key]['node-type'] == 'file') {
        new_node.type = NodeTypes.File;
        new_node.content = subtree[curr_node_key]['node-content'];
        node_dict[new_node.filepath] = new_node;
    }
    else if (subtree[curr_node_key]['node-type'] == 'folder') {
        new_node.type = NodeTypes.Directory;

        let new_st = subtree[curr_node_key]['node-content'];
        Object.keys(new_st).forEach(k => {
            getNodes(k, new_st, node_dict, new_node);
        });
    }
}

function computeDependencies(node, nodes) {
    node.dependencies = [];
    for (const k in node.content.Import) {
        let imp = node.content.Import[k];
        let cn = node;

        // Go up however many levels of the import
        for (let i = 0; i < imp.level; i += 1) {
            cn = cn.parent;
        }

        // Go down each import
        const fp = k.split('.');
        let valid = true;

        if (cn == undefined) {
            valid = false;
        }
        else {
            for (const j in fp) {
                let next_file = fp[j];
                if (cn.children_clean.hasOwnProperty(next_file.replace('_'))) {
                    cn = cn.children_clean[next_file.replace('_')];
                }
                else if (cn.children_clean.hasOwnProperty(next_file.replace('_') + '.txt')) {
                    cn = cn.children_clean[next_file.replace('_') + '.txt'];
                }
                else {
                    if (fp.length > 1 && j == fp.length - 1 && nodes.hasOwnProperty(cn.filepath) && node.filepath != cn.filepath) {
                        node.dependencies.push(cn.filepath);
                        nodes[cn.filepath].dependents.push(node.filepath);
                    }
                    valid = false;
                }
            }
        }
        if (valid && cn.filepath != node.filepath) {
            node.dependencies.push(cn.filepath);
            nodes[cn.filepath].dependents.push(node.filepath);
        }
    }
}

function topoSortNodes(nodes) {
    let out = [];
    let searchPath = [];
    let inDegree = {};
    let prevNodesProcessed = -1;
    let nodesProcessed = 0;

    for(const k in nodes){
        inDegree[k] = nodes[k].dependencies.length;
    }

    Object.keys(inDegree).forEach(e => {
        if (inDegree[e] == 0) {
            searchPath.push(e);
        }
    });

    while (nodesProcessed != Object.keys(nodes).length && nodesProcessed != prevNodesProcessed) {
        let currRow = [];
        let numToPop = searchPath.length;

        for (let i = 0; i < numToPop; i++) {
            let fk = searchPath.pop();
            currRow.push(fk);

            Object.keys(nodes[fk].dependents).forEach(e => {
                let dep = nodes[fk].dependents[e];
                inDegree[dep] -= 1;
                if (inDegree[dep] == 0){
                    searchPath.push(dep);
                }
            });
        }

        out.push(currRow);
        prevNodesProcessed = nodesProcessed;
        nodesProcessed += numToPop;
    }

    // There exists a cycle in these nodes, put them at the end -- sad!
    if (nodesProcessed != Object.keys(nodes).length) {
        let finalRow = [];
        Object.keys(inDegree).forEach(e => {
            if (inDegree[e] != 0) {
                finalRow.push(e);
            }
        });
        out.push(finalRow);
    }

    return out;
}

function goToView() {
    let req = new XMLHttpRequest();
    req.onreadystatechange = function () {
        if (req.readyState == 4 && req.status == 200) {
            this.content = JSON.parse(req.responseText);

            // Build node tree
            let init_key = Object.keys(this.content)[0];
            let root_node = new FileNode();
            this.nodes = {};
            if (this.content[init_key]['node-type'] == 'file') {
                root_node.type = NodeTypes.File;
                root_node.content = this.content[curr_node_key]['node-content'];
                this.nodes[root_node.filepath] = root_node;
            }
            else if (this.content[init_key]['node-type'] == 'folder') {
                root_node.type = NodeTypes.Directory;
                let new_st = this.content[init_key]['node-content'];

                for (const k in new_st) {
                    getNodes(k, new_st, this.nodes, root_node);
                }
            }
            root_node.filepath = this.content[init_key]['file-path'];
            root_node.filename = this.content[init_key]['file-name'];
            root_node.parent = undefined;


            for (const k in this.nodes) {
                computeDependencies(this.nodes[k], this.nodes);
                this.nodes[k].dependencies = Array.from(new Set(this.nodes[k].dependencies))
            }

            let sorted_nodes = topoSortNodes(this.nodes);

            this.cy = cytoscape({
                container: document.getElementById('cy'),
                style: [
                    {
                        "selector": "node[label]",
                        "style": {
                            "label": "data(label)"
                        }
                    }
                ]
            });

            Object.keys(sorted_nodes).forEach(level => {
                let currLevel = sorted_nodes[level];
                Object.keys(currLevel).forEach((k, i) => {
                    const e = this.nodes[currLevel[k]];
                    this.cy.add({
                        group: 'nodes',
                        data: { id: e.filepath, label: e.filename.replace('.txt', '') },
                        position: { x: i * 60, y: (sorted_nodes.length - level) * 400 + (i % 3) * 80 }
                    });
                });
            });

            Object.keys(this.nodes).forEach(k => {
                let nn = this.nodes[k];
                Object.keys(nn.dependencies).forEach(n => {
                    let depKey = nn.dependencies[n];
                    this.cy.add({
                        group: 'edges',
                        data: { source: nn.filepath, target: this.nodes[depKey].filepath }
                    });
                });
            });

            document.getElementById('file-upload').style.visibility = 'hidden';
            document.getElementById('main-content').style.visibility = 'visible';
        }
    }
    req.open('GET', 'http://localhost:5000/files');
    req.send();
}