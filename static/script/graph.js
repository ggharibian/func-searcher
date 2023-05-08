
const NodeTypes = {
    File: 0,
    Directory: 1
}

const FunctionType = {
    Call: 0,
    Definition: 1
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
    children_below_to_render = 0;
    children_clean = {};
    content = undefined;
    dependencies = new Set();
    dependents = new Set();
    lineno_map = {};
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
        new_node.lineno_map = {};

        Object.keys(new_node.content['FunctionCall']).forEach(fc => {
            new_node.content['FunctionCall'][fc]['line_num'].forEach(fcn => {
                if (!new_node.lineno_map.hasOwnProperty(fcn)) {
                    new_node.lineno_map[fcn] = [];
                }
                new_node.lineno_map[fcn].push([FunctionType.Call, fc]);
            });
        });
        Object.keys(new_node.content['FunctionDef']).forEach(fc => {
            new_node.content['FunctionDef'][fc]['lineno'].forEach(fdn => {
                if (!new_node.lineno_map.hasOwnProperty(fdn)) {
                    new_node.lineno_map[fdn] = [];
                }
                new_node.lineno_map[fdn].push([FunctionType.Definition, fc]);
            });
        });
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
        /*
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
                else if (cn.children_clean.hasOwnProperty(next_file.replace('_', '') + '.json')) {
                    cn = cn.children_clean[next_file.replaceAll('_', '') + '.json'];
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
        */

        if (nodes.hasOwnProperty(node.content.Import[k]['path'])) {
            node.dependencies.add(node.content.Import[k]['path']);
            nodes[node.content.Import[k]['path']].dependents.add(node.filepath);
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
        if ((cn.display_size <= ms && cn.children_below_to_render == 0) || cn.type == NodeTypes.File) {
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

function createDescBox(target) {
    if (target.data('name') == undefined) return;

    let tbb = target.boundingBox();
    let cbb = globalThis.cy.extent();
    let cyBaseBB = document.getElementById('cy').getBoundingClientRect();
    let clientX = cyBaseBB.x + ((tbb.x1 - cbb.x1) / cbb.w) * cyBaseBB.width;
    let clientY = cyBaseBB.y + ((tbb.y1 - cbb.y1) / cbb.h) * cyBaseBB.height;
    let clientW = (tbb.w / cbb.w) * cyBaseBB.width;
    let clientH = (tbb.h / cbb.h) * cyBaseBB.height;

    const popup = document.createElement("div");
    popup.id = 'local-name'
    popup.innerHTML = `
                <h1>${target.data('name').replace('.json', '')}</h1>`;
    popup.classList.add('local-name');
    document.getElementById('main-content').appendChild(popup);

    let pbb = document.getElementById('local-name').getBoundingClientRect();
    let y = 0;
    if (pbb.height <= clientY) {
        y = clientY - pbb.height - 3;

    }

    let x = clientX + (clientW - pbb.width) / 2;
    if (x < 0) {
        x = 0;
    }
    if (x + pbb.width > cyBaseBB.width) {
        x = cyBaseBB.width - pbb.width;
    }

    document.getElementById('local-name').style.top = y;
    document.getElementById('local-name').style.left = x;
}

function removeChildRenderRestriction(n) {
    if (n.children_below_to_render != 0) {
        n.children_below_to_render = 0;
        Object.values(n.children).forEach(e => {
            if (e.type == NodeTypes.Directory) {
                removeChildRenderRestriction(e);
            }
        });
    }
}

function updatePopupPosition() {
    if (globalThis.popupId != undefined) {
        const bbox1 = document.getElementById('popup').getBoundingClientRect();
        const bbox2 = document.getElementById(globalThis.popupId).getBoundingClientRect();
        if (bbox2.top < 39) {
            document.getElementById('popup').style.top = '39px';
        }
        else if (bbox2.top + bbox1.height >= window.innerHeight) {
            document.getElementById('popup').style.top = `${window.innerHeight - bbox1.height}px`;
        }
        else {
            document.getElementById('popup').style.top = `${bbox2.top}px`;
        }
    }
}

function closePopup() {
    document.getElementById('popup').remove();
    globalThis.popupId = undefined;
}

function getDefined(file, f, ft) {
    if (ft == FunctionType.Call) {
        return globalThis.nodes[file].content.FunctionCall[f]['defined'].map(m => `<div>${m}</div>`);
    }
    else {
        return "Function Definition"
    }
}

function onFunctionClick(id, file, ft, f) {

    let req = new XMLHttpRequest();
    req.onreadystatechange = function () {
        if (req.readyState == 4 && req.status == 200) {

            if (document.getElementById('popup') != undefined) {
                document.getElementById('popup').remove();
            }

            const popup = document.createElement("div");
            popup.id = 'popup'
            popup.style.top = `${document.getElementById(id).getBoundingClientRect().top}px`;
            globalThis.popupId = id;
            popup.innerHTML = `
                <h1>${f}</h1>
                <button onclick="closePopup()">
                <svg xmlns="http://www.w3.org/2000/svg" height="36" viewBox="0 96 960 960" width="36"><path d="m249 849-42-42 231-231-231-231 42-42 231 231 231-231 42 42-231 231 231 231-42 42-231-231-231 231Z"/></svg>
                </button>
                <div class='popup-toprow'>
                    <div class='popup-toprow-elem'>Defined</div>
                    ${getDefined(file, f, ft)}
                    <div class='popup-toprow-elem'>Other Calls</div>
                </div>
                <div>
                    ${JSON.parse(req.responseText).map(m => `<div>${m[0]}</div>`)}
                </div>
            `;
            popup.classList.add('popup');
            document.getElementById('main-content').appendChild(popup);
        }
    }
    req.open('GET', `http://localhost:5000/similar?file=${file}&function=${f}`);
    req.send();
}

function loadCodeOrFunction(parent, child) {
    onFolderDoubleClick(parent);
    if (globalThis.nodes.hasOwnProperty(child)) {
        loadCode(child);
    }
    else {
        loadFolder(child);
    }

    let n = globalThis.cy.nodes(`node[id="${child}"]`);
    n.select();
}

function onFolderDoubleClick(fid) {
    let n = globalThis.folders[fid];
    let cn = n;
    while (cn != undefined) {
        cn.children_below_to_render++;
        cn = cn.parent;
    }
    updateNodesInView(globalThis.cy.extent().h);
    globalThis.ghostFolders.push({
        group: 'nodes',
        data: { type: 'ghost', id: n.filepath + 'SIUUU', label: n.filename, w: n.w - DISPLAY_PADDING / 2, h: n.h - DISPLAY_PADDING / 2, z: 9 },
        position: { x: n.total_offset_x, y: n.total_offset_y },
        grabbable: false,
        style: { 'background-opacity': '0', 'border-width': '2', 'border-color': 'blue' }
    });
    updateView();
}

function loadFolder(tid) {
    document.getElementById('code-loaded').innerHTML = `
        <h2>${globalThis.folders[tid].filepath}</h2>
        Number of files: ${globalThis.folders[tid].size}<br>
        ${Object.keys(globalThis.folders[tid].children).map(c => {
        return `<div class='folder-in-code' onclick=loadCodeOrFunction("${tid}","${globalThis.folders[tid].children[c].filepath}")>${c.replace('.json', '.py')}</div>`
    }).join('')}
    `;
}

function updateView() {
    globalThis.cy.elements().remove();

    let activePathSet = new Set();
    Object.values(globalThis.nodesInView).forEach(n => {
        activePathSet.add(n.filepath);
    });

    globalThis.nodesInView.forEach(n => {
        if (n.size != 0) {
            if (n.type == NodeTypes.File) {
                let tf = n.filename.replace('.json', '');
                let nf = 15 / globalThis.cy.zoom();
                if (nf > 24) {
                    nf = 0;
                }
                if (tf.length * nf > 60) {
                    tf = tf.substring(0, Math.floor(60 / nf) + 1) + '...';
                }
                globalThis.cy.add({
                    group: 'nodes',
                    data: { type: 'file', id: n.filepath, name: n.filename, label: tf, size: n.display_size },
                    grabbable: false,
                    position: { x: n.total_offset_x, y: n.total_offset_y },
                    style: { 'font-size': `${nf}px` }
                });
            }
            else {
                globalThis.cy.add({
                    group: 'nodes',
                    data: { type: 'folder', id: n.filepath, label: n.filename, name: n.filename, w: n.w - DISPLAY_PADDING, h: n.h - DISPLAY_PADDING },
                    grabbable: false,
                    position: { x: n.total_offset_x, y: n.total_offset_y },
                    style: {
                        'font-size': `${n.w / n.filename.length} px`,
                        'text-halign': 'center',
                        'text-valign': 'center'
                    }
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

    let onMouseOver = event => {
        event.target.connectedEdges().style({ 'line-color': 'red' });
        createDescBox(event.target);
    };

    let onMouseOut = event => {
        if (!globalThis.currSelection.has(event.target.data('id'))) {
            event.target.connectedEdges().style({ 'line-color': '#ccc' });
        }
        if (document.getElementById('local-name') != null) {
            document.getElementById('local-name').remove();
        }

    };

    let ngs = new Set();
    globalThis.currSelection.forEach(s => {
        if (activePathSet.has(s)) {
            ngs.add(s);
            let n = globalThis.cy.nodes(`node[id="${s}"]`);
            n.select();
            n.connectedEdges().style({ 'line-color': 'red' });
        }
    });
    globalThis.currSelection = ngs;

    if (globalThis.activeName != undefined) {
        highlightCallTree(globalThis.activeName);
    }

    let onClick = event => {
        if (event.target.json().data.type == 'ghost') {
            let n = globalThis.folders[event.target.data('id').replace('SIUUU', '')];
            removeChildRenderRestriction(n);
            let cn = n.parent;
            while (cn != undefined) {
                cn.children_below_to_render--;
                cn = cn.parent;
            }
            globalThis.ghostFolders = globalThis.ghostFolders.filter(i => globalThis.folders[i.data.id.replace('SIUUU', '')].children_below_to_render != 0);
            updateNodesInView(globalThis.cy.extent().h);
            updateView();
        }
        else if (event.target.json().selected && event.target.json().data.type == 'folder') {
            onFolderDoubleClick(event.target.data('id'));
        }
    };

    function checkStr(s, r) {
        let m = s.match(r);
        if (m != null) {
            return m.length;
        }
        return 0;
    }

    let onSelection = event => {
        let tid = event.target.data('id');
        globalThis.currSelection.add(tid);
        globalThis.cy.nodes(`node[id="${tid}"]`).connectedEdges().style({ 'line-color': 'red' });

        if (globalThis.nodes.hasOwnProperty(tid) && globalThis.displayedCode != tid) {
            loadCode(tid);
        }
        else if (globalThis.folders.hasOwnProperty(tid)) {
            loadFolder(tid);
        }
    };
    let onUnselection = event => {
        let tid = event.target.data('id');
        globalThis.currSelection.delete(tid);
        globalThis.cy.nodes(`node[id="${tid}"]`).connectedEdges().style({ 'line-color': '#ccc' });
        document.getElementById('code-loaded').innerHTML = '';
        globalThis.displayedCode = undefined;
    };

    globalThis.ghostFolders.forEach(g => {
        globalThis.cy.add(g);
    });

    cy.nodes().unbind("mouseover");
    cy.nodes().bind("mouseover", onMouseOver);

    cy.nodes().unbind("mouseout");
    cy.nodes().bind("mouseout", onMouseOut);

    cy.nodes().unbind('tap');
    cy.nodes().bind('tap', onClick);

    globalThis.cy.on('select', 'node', onSelection);
    globalThis.cy.on('unselect', 'node', onUnselection);
}

function updateSlider() {
    document.getElementById('zoom-slider').value = (globalThis.cy.zoom() - 0.03) * 100 / (8.5 - 0.03);
}

function onZoomSliderChange() {
    let nv = document.getElementById('zoom-slider').value;
    globalThis.cy.zoom(nv / 100 * (8.5 - 0.03) + 0.03);
}

function updateGraphViewOnZoom() {
    globalThis.cy.elements().remove();
    updateNodesInView(globalThis.cy.extent().h);
    updateView();
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

function isMatch(uin, ref) {
    let output_map = [];
    let userWords = uin.split(' ');
    for (w in userWords) {
        let i = ref.indexOf(userWords[w]);
        if (i == -1) return [];

        if (i == 0) {
            output_map.push(
                [ref.substring(0, userWords[w].length), 'strong']
            );
        }
        else {
            output_map.push(
                [ref.substring(0, i), 'normal']
            );
            output_map.push(
                [ref.substring(i, i + userWords[w].length), 'strong']
            );
        }
        ref = ref.substring(i + userWords[w].length);
    }
    output_map.push(
        [ref, 'normal']
    );
    return output_map;
}

function highlightCallTree(name) {
    var filepath;
    if (name.split(' ').length == 1) {
        filepath = name.replace('py', 'json').split('/');
    }
    else {
        filepath = name.split(' ')[1].replace('(', '').replace(')', '').replace('py', 'json').split('/');
    }

    let rf = '';
    let viewablePathSet = new Set(globalThis.nodesInView.map(i => i.filepath));
    for (f in filepath) {
        rf += filepath[f];
        if (viewablePathSet.has(rf)) {
            break;
        }
        rf += '/';
    }

    let depEdgeSet = new Set();
    let depNodeSet = {};
    let searchQueue = [];
    searchQueue.push(rf);
    searchQueue.push('dependency');
    searchQueue.push(rf);
    searchQueue.push('dependent');

    while (searchQueue.length != 0) {
        let ctype = searchQueue.pop();
        let cn = searchQueue.pop();

        if (depNodeSet.hasOwnProperty(cn) && depNodeSet[cn] == ctype) {
            continue;
        }
        depNodeSet[cn] = ctype;
        let node = globalThis.nodes.hasOwnProperty(cn) ? globalThis.nodes[cn] : globalThis.folders[cn];

        if (ctype == 'dependency') {
            node.dependencies.forEach(c => {
                if (viewablePathSet.has(c) && c != cn) {
                    depEdgeSet.add([cn, c]);

                    if (!depNodeSet.hasOwnProperty(c) || depNodeSet[c] != ctype) {
                        searchQueue.push(c);
                        searchQueue.push('dependency');
                    }
                }
            });
        }
        else {
            node.dependents.forEach(c => {
                if (viewablePathSet.has(c) && c != cn) {
                    depEdgeSet.add([c, cn]);

                    if (!depNodeSet.hasOwnProperty(c) || depNodeSet[c] != ctype) {
                        searchQueue.push(c);
                        searchQueue.push('dependent');
                    }
                }
            });
        }
    }

    Object.keys(depNodeSet).forEach(k => {
        globalThis.cy.nodes(`node[id="${k}"]`).style({ 'background-color': 'red' });
    });
    depEdgeSet.forEach(e => {
        globalThis.cy.edges(`edge[source="${e[0]}"][target="${e[1]}"]`).style({ 'line-color': 'red' });
    });
}

function loadCode(tid) {
    let req = new XMLHttpRequest();
    req.onreadystatechange = function () {
        if (req.readyState == 4 && req.status == 200) {
            let ln = 1;
            let text = req.responseText;
            let os = '';
            const processLine = (line, num) => {
                line = line.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
                    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
                    .replaceAll('\t', '&emsp').replaceAll(' ', '&nbsp');
                if (globalThis.nodes[tid].lineno_map.hasOwnProperty(num)) {
                    globalThis.nodes[tid].lineno_map[num].forEach(c => {
                        line = line.replaceAll(c[1], `<span class="function-code" id="line-${ln}" onclick="onFunctionClick('line-${ln}','${tid}', ${c[0]}, '${c[1]}')">${c[1]}</span>`)
                    });
                }

                return `${line}<br>`;
            };

            while (text.indexOf('\n') != -1) {
                os += processLine(text.substring(0, text.indexOf('\n')), ln);
                text = text.substring(text.indexOf('\n') + 1);
                ln++;
            }
            os += processLine(text, ln);

            /*
            Prism.tokenize(req.responseText, Prism.languages['python']).forEach(t => {
                let currString = t;
                if (t.hasOwnProperty('content')) {
                    if (typeof t.content == 'string') {
                        currString = t.content;
                    }
                    else {
                        currString = t.content.reduce(
                            (a, cv) => a + cv,
                            ''
                        );
                    }
                }
                currString = currString.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
                    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
                console.log(ln);
                console.log(globalThis.nodes[tid].lineno_map);
                console.log(currString);
                if (globalThis.nodes[tid].lineno_map.hasOwnProperty(ln)) {
                    globalThis.nodes[tid].lineno_map[ln].forEach(c => {
                        currString.replaceAll(c, `<span onclick="onFunctionClick(${c})">${c}</span>`)
                    });
                }
                os += currString;

                if (t.hasOwnProperty('content')) {
                    if (typeof t.content == 'string') {
                        ln += checkStr(t.content, re);
                    }
                    else {
                        ln += t.content.reduce(
                            (a, cv) => a + checkStr(cv, re),
                            0
                        );
                    }
                }
                else {
                    ln += checkStr(t, re);
                }


            });
            */
            document.getElementById('code-loaded').innerHTML = os;
            /*
            document.getElementById('code-loaded').innerHTML = `
            <pre>
                <code class="language-python">
                    ${req.responseText}
                </code>
            </pre>`;*/

            Prism.highlightAll();
            //hljs.highlightAll();
            //hljs.initLineNumbersOnLoad();

            globalThis.displayedCode = tid;
        }
    }
    req.open('GET', `http://localhost:5000/raw?fpath=${tid.replace('json', 'py')}`);
    req.send();
}

// https://www.w3schools.com/howto/howto_js_autocomplete.asp
function setSearchView() {
    let inp = document.getElementById('func-search');
    let arr = [];
    Object.keys(globalThis.functionDefs).forEach(fDef => {
        globalThis.functionDefs[fDef].forEach(file => {
            arr.push(`${fDef} (${file.replace('json', 'py')})`)
        });
        if (globalThis.functionDefs[fDef].length == 0) {
            arr.push(fDef.replace('json', 'py'));
        }
    });
    /*the autocomplete function takes two arguments,
    the text field element and an array of possible autocompleted values:*/
    var currentFocus;
    /*execute a function when someone writes in the text field:*/
    inp.addEventListener("input", function (e) {
        var a, b, i, val = this.value;
        /*close any already open lists of autocompleted values*/
        closeAllLists();
        if (!val) { return false; }
        currentFocus = -1;
        /*create a DIV element that will contain the items (values):*/
        a = document.createElement("DIV");
        a.setAttribute("id", this.id + "autocomplete-list");
        a.setAttribute("class", "autocomplete-items");
        /*append the DIV element as a child of the autocomplete container:*/
        this.parentNode.appendChild(a);
        /*for each item in the array...*/
        for (i = 0; i < arr.length; i++) {
            /*check if the item starts with the same letters as the text field value:*/
            let omap = isMatch(val.toUpperCase(), arr[i].toUpperCase());
            if (omap.length != 0) {
                /*create a DIV element for each matching element:*/
                b = document.createElement("DIV");
                /*make the matching letters bold:*/
                omap.forEach(o => {
                    if (o[1] == 'strong') {
                        b.innerHTML += "<strong>" + o[0] + "</strong>";
                    }
                    else {
                        b.innerHTML += o[0];
                    }
                });
                /*insert a input field that will hold the current array item's value:*/
                b.innerHTML += "<input type='hidden' value='" + arr[i] + "'>";
                /*execute a function when someone clicks on the item value (DIV element):*/
                b.addEventListener("click", function (e) {
                    /*insert the value for the autocomplete text field:*/
                    inp.value = this.getElementsByTagName("input")[0].value;
                    globalThis.activeName = inp.value;
                    globalThis.cy.elements().remove();
                    updateView();

                    if (globalThis.activeName.indexOf(' ') != 0) {
                        let functionName = globalThis.activeName.substring(0, globalThis.activeName.indexOf(' '));
                        let filename = globalThis.activeName.substring(globalThis.activeName.indexOf('(') + 1, globalThis.activeName.length - 1).replace('.py', '.json');
                        loadCode(filename);
                        console.log(Object.keys(globalThis.nodes[filename].content.FunctionDef[functionName]));
                        onFunctionClick(`line-${globalThis.nodes[filename].content.FunctionDef[functionName]['lineno'][0]}`, filename, FunctionType.Definition, functionName);
                    }
                    else {
                        loadCode(globalThis.activeName);
                    }


                    /*close the list of autocompleted values,
                    (or any other open lists of autocompleted values:*/
                    closeAllLists();
                });
                a.appendChild(b);
            }
        }
    });
    /*execute a function presses a key on the keyboard:*/
    inp.addEventListener("keydown", function (e) {
        var x = document.getElementById(this.id + "autocomplete-list");
        if (x) x = x.getElementsByTagName("div");
        if (e.keyCode == 40) {
            /*If the arrow DOWN key is pressed,
            increase the currentFocus variable:*/
            currentFocus++;
            /*and and make the current item more visible:*/
            addActive(x);
        } else if (e.keyCode == 38) { //up
            /*If the arrow UP key is pressed,
            decrease the currentFocus variable:*/
            currentFocus--;
            /*and and make the current item more visible:*/
            addActive(x);
        } else if (e.keyCode == 13) {
            /*If the ENTER key is pressed, prevent the form from being submitted,*/
            e.preventDefault();
            if (currentFocus > -1) {
                /*and simulate a click on the "active" item:*/
                if (x) x[currentFocus].click();
            }
        }
    });
    function addActive(x) {
        /*a function to classify an item as "active":*/
        if (!x) return false;
        /*start by removing the "active" class on all items:*/
        removeActive(x);
        if (currentFocus >= x.length) currentFocus = 0;
        if (currentFocus < 0) currentFocus = (x.length - 1);
        /*add class "autocomplete-active":*/
        x[currentFocus].classList.add("autocomplete-active");
    }
    function removeActive(x) {
        /*a function to remove the "active" class from all autocomplete items:*/
        for (var i = 0; i < x.length; i++) {
            x[i].classList.remove("autocomplete-active");
        }
    }
    function closeAllLists(elmnt) {
        /*close all autocomplete lists in the document,
        except the one passed as an argument:*/
        var x = document.getElementsByClassName("autocomplete-items");
        for (var i = 0; i < x.length; i++) {
            if (elmnt != x[i] && elmnt != inp) {
                x[i].parentNode.removeChild(x[i]);
            }
        }
    }
    /*execute a function when someone clicks in the document:*/
    document.addEventListener("click", function (e) {
        closeAllLists(e.target);
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
            globalThis.folders[root_node.filepath] = root_node;
            globalThis.ghostFolders = [];
            globalThis.currSelection = new Set();
            globalThis.activeName = undefined;

            for (const k in globalThis.nodes) {
                computeDependencies(globalThis.nodes[k], globalThis.nodes);
            }
            computeFolderDependencies(root_node);
            for (const k in globalThis.nodes) {
                globalThis.nodes[k].dependents = augmentDependencySet(globalThis.nodes[k].dependents);
            }
            for (const k in globalThis.folders) {
                globalThis.folders[k].dependents = augmentDependencySet(globalThis.folders[k].dependents);
            }
            computeNodeLoc(root_node);

            globalThis.functionDefs = {};
            Object.values(globalThis.nodes).forEach(n => {
                Object.keys(n.content.FunctionDef).forEach(d => {
                    if (!globalThis.functionDefs.hasOwnProperty(d)) {
                        globalThis.functionDefs[d] = [];
                    }
                    globalThis.functionDefs[d].push(n.filepath);
                });
            });
            Object.values(globalThis.nodes).forEach(n => {
                Object.keys(n.content.ClassDef).forEach(d => {
                    if (!globalThis.functionDefs.hasOwnProperty(d)) {
                        globalThis.functionDefs[d] = [];
                    }
                    globalThis.functionDefs[d].push(n.filepath);
                });
            });
            Object.values(globalThis.nodes).forEach(n => {
                globalThis.functionDefs[n.filepath] = [];
            });

            setSearchView();

            globalThis.cy = cytoscape({
                container: document.getElementById('cy'),
                style: [
                    {
                        "selector": "node[label]",
                        "style": {
                            "label": "data(label)",
                            "width": node => node.data('type') != 'file' ? node.data('w') : node.data('size'),
                            "height": node => node.data('type') != 'file' ? node.data('h') : node.data('size'),
                            "shape": node => node.data('type') != 'file' ? "round-rectangle" : "ellipse",
                            "z-index": node => node.data('z') != undefined ? node.data('z') : 10,
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
            globalThis.cy.minZoom(0.03);
            globalThis.cy.maxZoom(8.5);
            globalThis.cy.on('zoom', updateGraphViewOnZoom);
            globalThis.nodesInView = [root_node];
            updateSlider();

            updateGraphViewOnZoom(undefined);
            globalThis.cy.center();
        }
    }
    req.open('GET', 'http://localhost:5000/files');
    req.send();
}

function onClearSelection() {
    globalThis.cy.elements().remove();
    globalThis.activeName = undefined;
    updateView();
    document.getElementById('func-search').value = '';
}

document.addEventListener('mouseup', (e) => {
    globalThis.lastClick = e.target.tagName;
});

document.addEventListener('keydown', (e) => {
    if (globalThis.lastClick != 'CANVAS') return

    let dx = 0;
    let dy = 0;
    if (e.code === "ArrowUp") {
        dy = 10;
    }
    else if (e.code === "ArrowDown") {
        dy = -10;
    }
    else if (e.code === "ArrowRight") {
        dx = -10;
    }
    else if (e.code === "ArrowLeft") {
        dx = 10;
    }
    else {
        return
    }

    globalThis.cy.panBy({ 'x': dx, 'y': dy });
});