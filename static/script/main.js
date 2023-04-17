
const NodeTypes = {
    File: 0,
    Directory: 1
}

class FileNode {
    parent = undefined;
    type = undefined;
    filename = '';
    filepath = '';
    size = 1;
    display_size = 0;
    w = 0;
    h = 0;
    display_offset_x = 0;
    display_offset_y = 0;
    total_offset_x = 0;
    total_offset_y = 0;
    children = {};
    x = 0;
    y = 0;
    children_clean = {};
    content = undefined;
    dependencies = new Set();
    dependents = new Set();
}

const SIZE_SCALE_FACTOR = 20;
const DISPLAY_PADDING = 40;
const WIDTH = 1000;
const HEIGHT = 800;

// https://observablehq.com/@mourner/simple-rectangle-packing
function packRectangles(boxes) {
    // calculate total box area and maximum box width
    let area = 0;
    let maxWidth = 0;

    for (const box of boxes) {
        area += box.w * box.h;
        maxWidth = Math.max(maxWidth, box.w);
    }

    // sort the boxes for insertion by height, descending
    boxes.sort((a, b) => b.h - a.h);

    // aim for a squarish resulting container,
    // slightly adjusted for sub-100% space utilization
    const startWidth = Math.max(Math.ceil(Math.sqrt(area / 0.95)), maxWidth);

    // start with a single empty space, unbounded at the bottom
    const spaces = [{ x: 0, y: 0, w: startWidth, h: Infinity }];

    let width = 0;
    let height = 0;

    for (const box of boxes) {
        // look through spaces backwards so that we check smaller spaces first
        for (let i = spaces.length - 1; i >= 0; i--) {
            const space = spaces[i];

            // look for empty spaces that can accommodate the current box
            if (box.w > space.w || box.h > space.h) continue;

            // found the space; add the box to its top-left corner
            // |-------|-------|
            // |  box  |       |
            // |_______|       |
            // |         space |
            // |_______________|
            box.x = space.x;
            box.y = space.y;

            height = Math.max(height, box.y + box.h);
            width = Math.max(width, box.x + box.w);

            if (box.w === space.w && box.h === space.h) {
                // space matches the box exactly; remove it
                const last = spaces.pop();
                if (i < spaces.length) spaces[i] = last;

            } else if (box.h === space.h) {
                // space matches the box height; update it accordingly
                // |-------|---------------|
                // |  box  | updated space |
                // |_______|_______________|
                space.x += box.w;
                space.w -= box.w;

            } else if (box.w === space.w) {
                // space matches the box width; update it accordingly
                // |---------------|
                // |      box      |
                // |_______________|
                // | updated space |
                // |_______________|
                space.y += box.h;
                space.h -= box.h;

            } else {
                // otherwise the box splits the space into two spaces
                // |-------|-----------|
                // |  box  | new space |
                // |_______|___________|
                // | updated space     |
                // |___________________|
                spaces.push({
                    x: space.x + box.w,
                    y: space.y,
                    w: space.w - box.w,
                    h: box.h
                });
                space.y += box.h;
                space.h -= box.h;
            }
            break;
        }
    }

    return {
        w: width, // container width
        h: height, // container height
        fill: (area / (width * height)) || 0 // space utilization
    };
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

function getNodes(curr_node_key, subtree, node_dict, folder_dict, parent) {
    let new_node = new FileNode();
    new_node.filepath = subtree[curr_node_key]['file-path'];
    new_node.filename = subtree[curr_node_key]['file-name'];
    new_node.parent = parent;
    parent.children[new_node.filename] = new_node;
    parent.children_clean[new_node.filename.replaceAll('_', '')] = new_node;
    if (subtree[curr_node_key]['node-type'] == 'file') {
        new_node.type = NodeTypes.File;
        new_node.content = subtree[curr_node_key]['node-content'];
        node_dict[new_node.filepath] = new_node;
        new_node.size = 1;
        new_node.display_size = SIZE_SCALE_FACTOR;
        new_node.w = SIZE_SCALE_FACTOR + DISPLAY_PADDING;
        new_node.h = SIZE_SCALE_FACTOR + DISPLAY_PADDING;
    }
    else if (subtree[curr_node_key]['node-type'] == 'folder') {
        new_node.type = NodeTypes.Directory;
        folder_dict[new_node.filepath] = new_node;
        let new_st = subtree[curr_node_key]['node-content'];
        new_node.size = 0;
        Object.keys(new_st).forEach(k => {
            getNodes(k, new_st, node_dict, folder_dict, new_node);
        });
        Object.keys(new_node.children).forEach(k => {
            new_node.size += new_node.children[k].size;
        });

        const { w, h, fill } = packRectangles(Object.values(new_node.children));
        new_node.w = w + DISPLAY_PADDING;
        new_node.h = h + DISPLAY_PADDING;
        new_node.display_size = Math.max(w, h);

        Object.values(new_node.children).forEach(n => {
            n.display_offset_x = n.x - w / 2 + n.w / 2;
            n.display_offset_y = n.y - h / 2 + n.h / 2;
        });

    }
}

function augmentDependencySet(deps) {
    let out = new Set();

    deps.forEach(d => {
        let components = d.split('/');
        let co = '';
        components.forEach(c => {
            co += c;
            out.add(co);
            co += '/';
        });
    });

    return out;
}

function computeDependencies(node, nodes) {
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
                if (cn.children_clean.hasOwnProperty(next_file.replaceAll('_', ''))) {
                    cn = cn.children_clean[next_file.replaceAll('_', '')];
                }
                else if (cn.children_clean.hasOwnProperty(next_file.replace('_', '') + '.txt')) {
                    cn = cn.children_clean[next_file.replaceAll('_', '') + '.txt'];
                }
                else {
                    if (fp.length > 1 && j == fp.length - 1 && nodes.hasOwnProperty(cn.filepath) && node.filepath != cn.filepath) {
                        node.dependencies.add(cn.filepath);
                        nodes[cn.filepath].dependents.add(node.filepath);
                    }
                    valid = false;
                }
            }
        }
        if (valid && cn.filepath != node.filepath) {
            node.dependencies.add(cn.filepath);
            nodes[cn.filepath].dependents.add(node.filepath);
        }
    }

    node.dependencies = augmentDependencySet(node.dependencies);
}

function computeFolderDependencies(node) {
    Object.keys(node.children).forEach(e => {
        if (node.children[e].type == 'file') {
            node.children[e].dependencies.forEach(d => {
                node.dependencies.add(d);
            });
            node.children[e].dependents.forEach(d => {
                node.dependents.add(d);
            });
        }
        else {
            computeFolderDependencies(node.children[e]);
            node.children[e].dependencies.forEach(d => {
                node.dependencies.add(d);
            });
            node.children[e].dependents.forEach(d => {
                node.dependents.add(d);
            });
        }
    });

    node.dependencies = augmentDependencySet(node.dependencies);
}

function topoSortNodes(nodes) {
    let out = [];
    let searchPath = [];
    let inDegree = {};
    let prevNodesProcessed = -1;
    let nodesProcessed = 0;

    for (const k in nodes) {
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
                if (inDegree[dep] == 0) {
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

function updateNodesInView(ms) {
    let newNodesInView = [];

    let searchQueue = [];
    searchQueue.push(globalThis.root);

    while (searchQueue.length != 0) {
        let cn = searchQueue.pop();
        if (cn.display_size <= ms || cn.type == NodeTypes.File) {
            newNodesInView.push(cn);
        }
        else {
            Object.keys(cn.children).forEach(k => {
                searchQueue.push(cn.children[k]);
            });
        }
    }

    globalThis.nodesInView = newNodesInView;
}

function updateGraphViewOnZoom(e) {
    globalThis.cy.elements().remove();
    updateNodesInView(globalThis.cy.extent().h);
    let activePathSet = new Set();
    Object.values(globalThis.nodesInView).forEach(n => {
        activePathSet.add(n.filepath);
    });

    globalThis.nodesInView.forEach(n => {
        if (n.size != 0) {
            if (n.type == NodeTypes.File) {
                globalThis.cy.add({
                    group: 'nodes',
                    data: { type: 'file', id: n.filepath, label: n.filename.replace('.txt', ''), size: n.display_size },
                    position: { x: n.total_offset_x, y: n.total_offset_y },
                });
            }
            else {
                globalThis.cy.add({
                    group: 'nodes',
                    data: { type: 'folder', id: n.filepath, label: n.filename, w: n.w - DISPLAY_PADDING, h: n.h - DISPLAY_PADDING },
                    position: { x: n.total_offset_x, y: n.total_offset_y },
                });
            }
        }
    });

    globalThis.nodesInView.forEach(n => {
        if (n.size != 0) {
            n.dependencies.forEach(d => {
                if (activePathSet.has(d) && d != n.filepath) {
                    globalThis.cy.add({
                        group: 'edges',
                        data: { source: n.filepath, target: d }
                    });
                }
            });
        }
    });
}

function computeNodeLoc(node) {
    if (node.parent != undefined) {
        node.total_offset_x = node.parent.total_offset_x + node.display_offset_x;
        node.total_offset_y = node.parent.total_offset_y + node.display_offset_y;
    }

    Object.values(node.children).forEach(e => {
        computeNodeLoc(e);
    });
}

function goToView() {
    let req = new XMLHttpRequest();
    req.onreadystatechange = function () {
        if (req.readyState == 4 && req.status == 200) {
            globalThis.content = JSON.parse(req.responseText);

            // Build node tree
            let init_key = Object.keys(globalThis.content)[0];
            let root_node = new FileNode();
            globalThis.nodes = {};
            globalThis.folders = {};
            if (globalThis.content[init_key]['node-type'] == 'file') {
                root_node.type = NodeTypes.File;
                root_node.content = globalThis.content[curr_node_key]['node-content'];
                globalThis.nodes[root_node.filepath] = root_node;
                root_node.size = 1;
                root_node.display_size = SIZE_SCALE_FACTOR;
            }
            else if (globalThis.content[init_key]['node-type'] == 'folder') {
                root_node.type = NodeTypes.Directory;
                let new_st = globalThis.content[init_key]['node-content'];
                globalThis.folders[root_node.filepath] = root_node;
                root_node.size = 0;
                for (const k in new_st) {
                    getNodes(k, new_st, globalThis.nodes, globalThis.folders, root_node);
                }
                for (const k in root_node.children) {
                    root_node.size += root_node.children[k].size;
                }

                const { w, h, fill } = packRectangles(Object.values(root_node.children));
                root_node.w = w + DISPLAY_PADDING;
                root_node.h = h + DISPLAY_PADDING;
                root_node.display_size = Math.max(w, h);

                Object.values(root_node.children).forEach(n => {
                    n.display_offset_x = n.x - w / 2 + n.w / 2;
                    n.display_offset_y = n.y - h / 2 + n.h / 2;
                });

            }
            root_node.filepath = globalThis.content[init_key]['file-path'];
            root_node.filename = globalThis.content[init_key]['file-name'];
            root_node.parent = undefined;
            root_node.display_offset_x = WIDTH / 2;
            root_node.display_offset_y = HEIGHT / 2;
            root_node.total_offset_x = WIDTH / 2;
            root_node.total_offset_y = HEIGHT / 2;
            globalThis.root = root_node;

            for (const k in globalThis.nodes) {
                computeDependencies(globalThis.nodes[k], globalThis.nodes);
            }
            computeFolderDependencies(root_node);
            computeNodeLoc(root_node);

            globalThis.cy = cytoscape({
                container: document.getElementById('cy'),
                style: [
                    {
                        "selector": "node[label]",
                        "style": {
                            "label": "data(label)",
                            "width": node => node.data('type') == 'file' ? node.data('size') : node.data('w'),
                            "height": node => node.data('type') == 'file' ? node.data('size') : node.data('h'),
                            "shape": node => node.data('type') == 'file' ? "ellipse" : "round-rectangle",
                        }
                    },
                    {
                        selector: 'edge',
                        style: {
                            'width': 3,
                            'line-color': '#ccc',
                            'target-arrow-color': '#ccc',
                            'target-arrow-shape': 'triangle',
                            'curve-style': 'bezier'
                        }
                    }

                ]
            });
            globalThis.cy.on('zoom', updateGraphViewOnZoom);
            globalThis.nodesInView = [root_node];

            updateGraphViewOnZoom(undefined);

            document.getElementById('file-upload').style.visibility = 'hidden';
            document.getElementById('main-content').style.visibility = 'visible';
        }
    }
    req.open('GET', 'http://localhost:5000/files');
    req.send();
}