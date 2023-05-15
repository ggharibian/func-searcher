
const NodeTypes = {
    File: 0,
    Directory: 1
}

const FunctionType = {
    Call: 0,
    Definition: 1,
    ClassDef: 2
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
    callMap = {};
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
        Object.keys(new_node.content['ClassDef']).forEach(fc => {
            const fdn = new_node.content['ClassDef'][fc]['lineno'];
            if (!new_node.lineno_map.hasOwnProperty(fdn)) {
                new_node.lineno_map[fdn] = [];
            }
            new_node.lineno_map[fdn].push([FunctionType.ClassDef, fc]);
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
        if (nodes.hasOwnProperty(node.content.Import[k]['path'])) {
            node.dependencies.add(node.content.Import[k]['path']);
            nodes[node.content.Import[k]['path']].dependents.add(node.filepath);
        }
    }

    node.originalDependencies = node.dependencies;
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
    if (globalThis.popupId != undefined && document.getElementById(globalThis.popupId) != null) {
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

function goToFunction(functionName, filename, preference) {

    let lineno = 0;
    let ftype = FunctionType.Definition;
    if (preference == 'Def') {
        if (globalThis.nodes[filename].content.FunctionDef.hasOwnProperty(functionName)) {
            lineno = globalThis.nodes[filename].content.FunctionDef[functionName]['lineno'][0];
            ftype = FunctionType.Definition;
        }
        else if (globalThis.nodes[filename].content.ClassDef.hasOwnProperty(functionName)) {
            lineno = globalThis.nodes[filename].content.ClassDef[functionName]['lineno'];
            ftype = FunctionType.ClassDef;
        }
        else if (globalThis.nodes[filename].content.FunctionCall.hasOwnProperty(functionName)) {
            lineno = globalThis.nodes[filename].content.FunctionCall[functionName]['line_num'][0];
            ftype = FunctionType.Call;
        }
        else {
            console.log('Not found!!! ');
            return;
        }

    }
    else {
        if (globalThis.nodes[filename].content.FunctionCall.hasOwnProperty(functionName)) {
            lineno = globalThis.nodes[filename].content.FunctionCall[functionName]['line_num'][0];
            ftype = FunctionType.Call;
        }
        else if (globalThis.nodes[filename].content.FunctionDef.hasOwnProperty(functionName)) {
            lineno = globalThis.nodes[filename].content.FunctionDef[functionName]['lineno'][0];
            ftype = FunctionType.Definition;
        }
        else if (globalThis.nodes[filename].content.ClassDef.hasOwnProperty(functionName)) {
            lineno = globalThis.nodes[filename].content.ClassDef[functionName]['lineno'];
            ftype = FunctionType.ClassDef;
        }
        else {
            console.log('Not found!!! ');
            return;
        }
    }

    loadCode(filename, scrollToFunction(functionName, preference));
    onFunctionClick(`line-${lineno}`, filename, ftype, functionName);

    let fpathArr = filename.split('/');
    let cpath = fpathArr[0];
    let i = 1;
    while (globalThis.cy.nodes(`node[id="${cpath}"]`).length == 0) {
        cpath += '/';
        cpath += fpathArr[i];
        i++;
        if (i >= fpathArr.length) {
            break;
        }
    }
    if (globalThis.cy.nodes(`node[id="${cpath}"]`).length != 0) {
        while (cpath != filename) {
            onFolderDoubleClick(cpath);
            cpath += '/';
            cpath += fpathArr[i];
            i++;
        }
        globalThis.cy.animate({ center: { eles: globalThis.cy.nodes(`node[id="${cpath}"]`) } }, { duration: 1000 });
    }
    else {
        globalThis.cy.animate({ center: { eles: globalThis.cy.nodes(`node[id="${globalThis.nodes[filename].filepath}"]`) } }, { duraiton: 1000 });
    }
}

function safeGoToFunction(file, func, preference) {
    if (!globalThis.nodes.hasOwnProperty(file)) {
        const extImportDialog = document.createElement('div');
        extImportDialog.id = 'external-import-dialog';
        if (file == 'builtin') {
            extImportDialog.innerHTML = `This is a builtin function or class in Python`;
        }
        else {
            extImportDialog.innerHTML = `This is an external import: check the library documentation`;
        }
        extImportDialog.classList.add('external-import-dialog');
        document.getElementById('main-content').appendChild(extImportDialog);
        const tbox = document.getElementById('def-title').getBoundingClientRect();
        const mbox = extImportDialog.getBoundingClientRect();
        extImportDialog.style.top = tbox.top;
        extImportDialog.style.left = tbox.left + (tbox.width - mbox.width) / 2;
        setTimeout(function () { document.getElementById('external-import-dialog').remove(); }, 3000);
    }
    else {
        globalThis.cy.nodes().unselect();
        goToFunction(func, file, preference);
    }
}

function getDefined(file, f, ft) {
    if (ft == FunctionType.Call) {
        return globalThis.nodes[file].content.FunctionCall[f]['defined'].map(m => `<div onclick="safeGoToFunction('${m}', '${f}', 'Def')" style="cursor: pointer;">${m.replace('.json', '.py')}</div>`).join('');
    }
    else {
        return `<span>Right here👍 </span>`;
    }
}

function getOtherCalls(file, f, ft) {
    if (ft == FunctionType.Call) {
        return globalThis.nodes[file].content.FunctionCall[f]['other-calls'].map(m => `<div onclick="safeGoToFunction('${m}', '${f}', 'Call')" style="cursor: pointer;">${m.replace('.json', '.py')}</div>`).join('');
    }
    else if (ft == FunctionType.Definition) {
        return globalThis.nodes[file].content.FunctionDef[f]['other-calls'].map(m => `<div onclick="safeGoToFunction('${m}', '${f}', 'Call')" style="cursor: pointer;">${m.replace('.json', '.py')}</div>`).join('');
    }
    else {
        return globalThis.nodes[file].content.ClassDef[f]['other-calls'].map(m => `<div onclick="safeGoToFunction('${m}', '${f}', 'Call')" style="cursor: pointer;">${m.replace('.json', '.py')}</div>`).join('');
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
            globalThis.popupId = id;
            popup.innerHTML = `
                <h1>${f}</h1>
                <button onclick="closePopup()">
                <svg xmlns="http://www.w3.org/2000/svg" height="36" viewBox="0 96 960 960" width="36"><path d="m249 849-42-42 231-231-231-231 42-42 231 231 231-231 42 42-231 231 231 231-42 42-231-231-231 231Z"/></svg>
                </button>
                <div class='popup-toprow' id='par-row'>
                    <div class='popup-toprow-elem' id='defbox' style="border-right: 1px #03254E solid;">
                        <h2 id='def-title'>Defined</h2>
                        ${getDefined(file, f, ft)}
                    </div>
                    <div class='popup-toprow-elem' id='callbox' style="border-left: 1px #03254E solid;">
                        <h2>Called</h2>
                        ${getOtherCalls(file, f, ft)}
                    </div>
                </div>
                <div class='sim-functions'>
                    <h2>Similar Functions</h2>
                    ${JSON.parse(req.responseText).map(m => `<div onclick="safeGoToFunction('${m.split('|')[0]}', '${m.split('|')[1]}', 'Def')" style="cursor: pointer;">${m.split('|')[0].replace('.json', '.py')}: ${m.split('|')[1]}</div>`).join('')}
                </div>
            `;
            popup.classList.add('popup');
            document.getElementById('main-content').appendChild(popup);
            document.getElementById('defbox').style.paddingRight = `${Math.max(8, (document.getElementById('defbox').getBoundingClientRect().left - document.getElementById('par-row').getBoundingClientRect().left) / 2)}px`;
            document.getElementById('callbox').style.paddingLeft = `${Math.max(8, (document.getElementById('par-row').getBoundingClientRect().right - document.getElementById('callbox').getBoundingClientRect().right) / 2)}px`;
            updatePopupPosition();
        }
    }
    let fileString = file;
    if (ft == FunctionType.Call)
        fileString = globalThis.nodes[file].content.FunctionCall[f]['defined'].length > 0 ? globalThis.nodes[file].content.FunctionCall[f]['defined'][0] : '';

    req.open('GET', `http://localhost:5000/similar?file=${fileString}&function=${f}`);
    req.send();
}

function loadCodeOrFunction(parent, child) {
    if (!globalThis.ghostFolders.some(e => { return e.data.id == parent + 'SIUUU'; })) {
        onFolderDoubleClick(parent);
    }
    if (globalThis.nodes.hasOwnProperty(child)) {
        loadCode(child, undefined);
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
                        data: { source: n.filepath, target: d },
                        style: { 'z-index': 0 }
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
            if (!globalThis.currSearchDepSet.hasOwnProperty(event.target.data('id'))) {
                event.target.connectedEdges().style({ 'line-color': '#ccc' });
            }
            else {
                event.target.connectedEdges().style({ 'line-color': '#ccc' });
                let viewablePathSet = new Set(globalThis.nodesInView.map(i => i.filepath));
                globalThis.currSearchDepSet[event.target.data('id')].forEach(e => {
                    let e0 = e[0];
                    let e1 = e[1];
                    while (!viewablePathSet.has(e0)) {
                        e0 = e0.substring(0, e0.lastIndexOf('/'));
                    }
                    while (!viewablePathSet.has(e1)) {
                        e1 = e1.substring(0, e1.lastIndexOf('/'));
                    }
                    globalThis.cy.edges(`edge[source="${e0}"][target="${e1}"]`).style({ 'line-color': `${e[2]}` });
                });
            }
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
            loadCode(tid, undefined);
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

function highlightCallTreeFunction(fileArr, func) {
    let fileName = fileArr.join('/');
    let depEdgeSet = new Set();
    let processedNodeSet = new Set();
    let depNodeSet = {};

    depNodeSet[fileName] = 'dependency';
    processedNodeSet.add(fileName);

    let searchQueue = [];
    if (globalThis.nodes[fileName].content['FunctionDef'].hasOwnProperty(func)) {
        globalThis.nodes[fileName].content['FunctionDef'][func]['calls'].forEach(c => {
            const cs = c.split('|');
            globalThis.nodes[fileName].content['FunctionCall'][cs[1]]['defined'].forEach(d => {
                if (globalThis.nodes.hasOwnProperty(d)) {
                    searchQueue.push([d, cs[1], fileName]);
                }
            });
        });
    }
    else if (globalThis.nodes[fileName].content['ClassDef'].hasOwnProperty(func)) {
        globalThis.nodes[fileName].content['ClassDef'][func]['calls'].forEach(c => {
            const cs = c.split('|');
            globalThis.nodes[fileName].content['FunctionCall'][cs[1]]['defined'].forEach(d => {
                if (globalThis.nodes.hasOwnProperty(d)) {
                    searchQueue.push([d, cs[1], fileName]);
                }
            });
        });
    }

    while (searchQueue.length != 0) {
        let cfa = searchQueue.pop();
        if (processedNodeSet.has(cfa[0]) || !globalThis.nodes[cfa[0]].content['FunctionDef'].hasOwnProperty(cfa[1])) continue
        depNodeSet[cfa[0]] = 'dependency';
        depEdgeSet.add([cfa[2], cfa[0], 'red']);
        globalThis.nodes[cfa[0]].content['FunctionDef'][cfa[1]]['calls'].forEach(c => {
            const cs = c.split('|');
            globalThis.nodes[cfa[0]].content['FunctionCall'][cs[1]]['defined'].forEach(d => {
                if (globalThis.nodes.hasOwnProperty(d)) {
                    searchQueue.push([d, cs[1], cfa[0]]);
                }
            });
        });
        processedNodeSet.add(cfa[0]);
    }

    if (globalThis.nodes[fileName].content['FunctionDef'].hasOwnProperty(func)) {
        globalThis.nodes[fileName].content['FunctionDef'][func]['other-calls'].forEach(c => {
            if (globalThis.nodes.hasOwnProperty(c)) {
                searchQueue.push([c, func, fileName]);
            }
        });
    }
    else if (globalThis.nodes[fileName].content['ClassDef'].hasOwnProperty(func)) {
        globalThis.nodes[fileName].content['ClassDef'][func]['other-calls'].forEach(c => {
            if (globalThis.nodes.hasOwnProperty(c)) {
                searchQueue.push([c, func, fileName]);
            }
        });
    }


    while (searchQueue.length != 0) {
        let cfa = searchQueue.pop();
        let fqfunc = cfa[2] + '|' + cfa[1];
        if (processedNodeSet.has(cfa[0]) || !globalThis.nodes[cfa[0]].callMap.hasOwnProperty(fqfunc)) continue

        depNodeSet[cfa[0]] = 'dependent';
        depEdgeSet.add([cfa[0], cfa[2], 'blue']);
        globalThis.nodes[cfa[0]].callMap[fqfunc].forEach(fdef => {
            globalThis.nodes[cfa[0]].content.FunctionDef[fdef]['other-calls'].forEach(oc => {
                if (globalThis.nodes.hasOwnProperty(oc)) {
                    searchQueue.push([oc, fdef, cfa[0]]);
                }
            });
        });
        processedNodeSet.add(cfa[0]);
    }

    highlightSet(depEdgeSet, depNodeSet);
}

function highlightSet(depEdgeSet, depNodeSet) {
    let visibleNodeMap = {};
    let viewablePathSet = new Set(globalThis.nodesInView.map(i => i.filepath));
    Object.keys(depNodeSet).forEach(n => {
        let origN = n;
        while (!viewablePathSet.has(n)) {
            n = n.substring(0, n.lastIndexOf('/'));
        }
        visibleNodeMap[origN] = n;
    });

    globalThis.currSearchDepSet = {};
    Object.keys(depNodeSet).forEach(k => {
        globalThis.cy.nodes(`node[id="${visibleNodeMap[k]}"]`).style({ 'background-color': `${depNodeSet[k] == 'dependency' ? 'red' : 'blue'}` });
    });
    depEdgeSet.forEach(e => {
        globalThis.cy.edges(`edge[source="${visibleNodeMap[e[0]]}"][target="${visibleNodeMap[e[1]]}"]`).style({ 'z-index': '5', 'line-color': `${e[2]}` });
        if (!globalThis.currSearchDepSet.hasOwnProperty(visibleNodeMap[e[0]])) {
            globalThis.currSearchDepSet[visibleNodeMap[e[0]]] = [];
        }
        if (!globalThis.currSearchDepSet.hasOwnProperty(visibleNodeMap[e[1]])) {
            globalThis.currSearchDepSet[visibleNodeMap[e[1]]] = [];
        }
        globalThis.currSearchDepSet[visibleNodeMap[e[0]]].push(e);
        globalThis.currSearchDepSet[visibleNodeMap[e[1]]].push(e);
    });
}

function highlightCallTreeFile(name) {
    let depEdgeSet = new Set();
    let depNodeSet = {};
    let searchQueue = [];
    searchQueue.push(name);
    searchQueue.push('dependency');
    searchQueue.push(name);
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
            node.originalDependencies.forEach(c => {
                if (c != cn) {
                    depEdgeSet.add([cn, c, 'red']);

                    if (!depNodeSet.hasOwnProperty(c) || depNodeSet[c] != ctype) {
                        searchQueue.push(c);
                        searchQueue.push('dependency');
                    }
                }
            });
        }
        else {
            node.originalDependents.forEach(c => {
                if (c != cn) {
                    depEdgeSet.add([c, cn, 'blue']);

                    if (!depNodeSet.hasOwnProperty(c) || depNodeSet[c] != ctype) {
                        searchQueue.push(c);
                        searchQueue.push('dependent');
                    }
                }
            });
        }
    }

    highlightSet(depEdgeSet, depNodeSet);
}

function highlightCallTree(name) {
    var filepath;
    if (name.split(' ').length == 1) {
        filepath = name.replace('.py', '.json');
        highlightCallTreeFile(filepath);
    }
    else {
        filepath = name.split(' ')[1].replace('(', '').replace(')', '').replace('py', 'json').split('/');
        highlightCallTreeFunction(filepath, name.split(' ')[0]);
    }
}

function closeExplanation() {
    document.getElementById('explain-window').remove();
    document.getElementById('code-info-widget').innerHTML = '<button title="Explain Code" onclick="searchFunctionDetail()"><svg xmlns="http://www.w3.org/2000/svg" height="36" viewBox="0 96 960 960" width="36"><path d="M484 809q16 0 27-11t11-27q0-16-11-27t-27-11q-16 0-27 11t-11 27q0 16 11 27t27 11Zm-35-146h59q0-26 6.5-47.5T555 566q31-26 44-51t13-55q0-53-34.5-85T486 343q-49 0-86.5 24.5T345 435l53 20q11-28 33-43.5t52-15.5q34 0 55 18.5t21 47.5q0 22-13 41.5T508 544q-30 26-44.5 51.5T449 663Zm31 313q-82 0-155-31.5t-127.5-86Q143 804 111.5 731T80 576q0-83 31.5-156t86-127Q252 239 325 207.5T480 176q83 0 156 31.5T763 293q54 54 85.5 127T880 576q0 82-31.5 155T763 858.5q-54 54.5-127 86T480 976Zm0-60q142 0 241-99.5T820 576q0-142-99-241t-241-99q-141 0-240.5 99T140 576q0 141 99.5 240.5T480 916Zm0-340Z"/></svg></button>';
}

function searchFunctionDetail() {
    if (document.getElementById('code-loaded').contains(window.getSelection().anchorNode)) {
        let query = window.getSelection().toString();
        document.getElementById('code-info-widget').innerHTML = '<button title="Explain Code" onclick="closeExplanation()"><svg xmlns="http://www.w3.org/2000/svg" height="36" viewBox="0 96 960 960" width="36"><path d="m249 849-42-42 231-231-231-231 42-42 231 231 231-231 42 42-231 231 231 231-42 42-231-231-231 231Z"/></svg></button>';
        const explanationWindow = document.createElement('div');
        explanationWindow.id = 'explain-window';
        explanationWindow.classList.add('explain-window');
        explanationWindow.style.top = document.getElementById('code-info-widget').getBoundingClientRect().bottom - 3;
        explanationWindow.innerHTML = `
                    <h1>Code Explanation</h1>
                    <div style="padding: 4px" id='explanation-text'>Loading...</div>
                `;

        document.getElementById('sidebar').appendChild(explanationWindow);
        let req = new XMLHttpRequest();
        req.onreadystatechange = function () {
            if (req.readyState == 4 && req.status == 200) {
                document.getElementById('explanation-text').innerHTML = req.responseText.replaceAll('\n', '<br>').replaceAll('"', '&quot;');
            }
        }

        req.open('POST', `http://localhost:5000/explain`);
        req.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
        const data = JSON.stringify({ "segment": query });
        req.send(data);
    }
}

function onMouseUpCode(event) {
    if (document.getElementById('code-info-widget') != null) {
        return;
    }

    let codeInfoWidget = document.createElement('div');
    codeInfoWidget.id = 'code-info-widget';
    codeInfoWidget.classList.add('code-info-widget');
    codeInfoWidget.style.right = `14px`;
    codeInfoWidget.innerHTML = '<button title="Explain Code" onclick="searchFunctionDetail()"><svg xmlns="http://www.w3.org/2000/svg" height="36" viewBox="0 96 960 960" width="36"><path d="M484 809q16 0 27-11t11-27q0-16-11-27t-27-11q-16 0-27 11t-11 27q0 16 11 27t27 11Zm-35-146h59q0-26 6.5-47.5T555 566q31-26 44-51t13-55q0-53-34.5-85T486 343q-49 0-86.5 24.5T345 435l53 20q11-28 33-43.5t52-15.5q34 0 55 18.5t21 47.5q0 22-13 41.5T508 544q-30 26-44.5 51.5T449 663Zm31 313q-82 0-155-31.5t-127.5-86Q143 804 111.5 731T80 576q0-83 31.5-156t86-127Q252 239 325 207.5T480 176q83 0 156 31.5T763 293q54 54 85.5 127T880 576q0 82-31.5 155T763 858.5q-54 54.5-127 86T480 976Zm0-60q142 0 241-99.5T820 576q0-142-99-241t-241-99q-141 0-240.5 99T140 576q0 141 99.5 240.5T480 916Zm0-340Z"/></svg></button>';
    document.getElementById('sidebar').appendChild(codeInfoWidget);
    codeInfoWidget.style.top = document.getElementById('graph-side').getBoundingClientRect().height;
}

function scrollToFunction(fname, preference) {
    return function () {
        let ln = undefined;
        if (preference == 'Def') {
            if (globalThis.nodes[globalThis.displayedCode].content['FunctionDef'].hasOwnProperty(fname)) {
                ln = globalThis.nodes[globalThis.displayedCode].content['FunctionDef'][fname]['lineno'][0];
            }
            else if (globalThis.nodes[globalThis.displayedCode].content['ClassDef'].hasOwnProperty(fname)) {
                ln = globalThis.nodes[globalThis.displayedCode].content['ClassDef'][fname]['lineno'];
            }
            else {
                ln = globalThis.nodes[globalThis.displayedCode].content['FunctionCall'][fname]['line_num'][0];
            }
        }
        else {
            if (globalThis.nodes[globalThis.displayedCode].content['FunctionCall'].hasOwnProperty(fname)) {
                ln = globalThis.nodes[globalThis.displayedCode].content['FunctionCall'][fname]['line_num'][0];
            }
            else if (globalThis.nodes[globalThis.displayedCode].content['FunctionDef'].hasOwnProperty(fname)) {
                ln = globalThis.nodes[globalThis.displayedCode].content['FunctionDef'][fname]['lineno'][0];
            }

            else if (globalThis.nodes[globalThis.displayedCode].content['ClassDef'].hasOwnProperty(fname)) {
                ln = globalThis.nodes[globalThis.displayedCode].content['ClassDef'][fname]['lineno'];
            }

        }
        document.getElementById(`line-${ln}`).scrollIntoView();
    }
}

function getLineNumbers(ln) {
    let out = '';
    for (let i = 0; i < ln; i++) {
        out += `<span>${i + 1}</span>`;
    }
    return out;
}

function loadCode(tid, postExecutionCallback) {
    let req = new XMLHttpRequest();
    req.onreadystatechange = function () {
        if (req.readyState == 4 && req.status == 200) {
            let ln = 1;
            let os = '';
            const processLine = (line, num) => {
                line = line.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
                    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
                    .replaceAll('\t', '&emsp').replaceAll(' ', '&nbsp');

                return line;
            };

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

                let cso = '';
                while (currString.indexOf('\n') != -1) {
                    cso += processLine(currString.substring(0, currString.indexOf('\n')), ln);
                    cso += '\n';
                    currString = currString.substring(currString.indexOf('\n') + 1);
                    ln++;
                }
                cso += processLine(currString, ln);

                if (t.type == 'triple-quoted-string') {
                    t.type = 'comment';
                }
                if (t.type == undefined || t.type == 'punctuation' || t.type == 'function' || t.type == 'builtin') {
                    os += cso.replaceAll('\n', '<br>');
                }
                else {
                    os += `<span class="token ${t.type}">${cso.replaceAll('\n', '<br>')}</span>`;
                }
            });
            os = os.split('<br>').map((l, i) => {
                if (globalThis.nodes[tid].lineno_map.hasOwnProperty(i + 1)) {
                    globalThis.nodes[tid].lineno_map[i + 1].forEach(c => {
                        if (c[0] == FunctionType.Call || c[0] == FunctionType.Definition) {
                            l = l.replaceAll(c[1] + '(', `<span class="function-code" id="line-${i + 1}" onclick="onFunctionClick('line-${i + 1}','${tid}', ${c[0]}, '${c[1]}')">${c[1]}</span>(`)
                        }
                        else {
                            l = l.replaceAll(c[1], `<span class="function-code" id="line-${i + 1}" onclick="onFunctionClick('line-${i + 1}','${tid}', ${c[0]}, '${c[1]}')">${c[1]}</span>&nbsp;`)
                        }
                    });
                }
                return l;
            }).join('<br>');

            document.getElementById('code-loaded').innerHTML = `
            <h2>${tid}</h2>
            <div style="display: flex; flex-direction: row; overflow-x: scroll; width: max-content;" ">
                <div id="line-numbers" class='line-numbers'>
                    ${getLineNumbers(ln)}
                </div>
                <pre class="language-python" id='code'>
                    <code class="language-python">
                        ${os}
                    </code>
                </pre>
            </div>`;
            document.getElementById('line-numbers').style.top = document.getElementById('code').getBoundingClientRect().top;
            document.getElementById('code-loaded').addEventListener('mouseup', onMouseUpCode);

            globalThis.displayedCode = tid;
            if (postExecutionCallback != undefined) {
                postExecutionCallback();
            }
        }
    }
    req.open('GET', `http://localhost:5000/raw?fpath=${tid.replace('json', 'py')}`);
    req.send();
}

// https://www.w3schools.com/howto/howto_js_autocomplete.asp
function setSearchView() {
    let inp = document.getElementById('func-search');
    let arr = Object.keys(globalThis.nodes).map(m => m.replace('.json', '.py'));
    Object.keys(globalThis.functionDefs).forEach(fDef => {
        globalThis.functionDefs[fDef].forEach(file => {
            arr.push(`${fDef} (${file.replace('json', 'py')})`)
        });
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

                    if (inp.value.indexOf(' ') != -1) {
                        globalThis.activeName = inp.value;
                        globalThis.cy.elements().remove();
                        updateView();
                        let functionName = globalThis.activeName.substring(0, globalThis.activeName.indexOf(' '));
                        let filename = globalThis.activeName.substring(globalThis.activeName.indexOf('(') + 1, globalThis.activeName.length - 1).replace('.py', '.json');
                        goToFunction(functionName, filename, 'Def');
                    }
                    else {
                        globalThis.activeName = inp.value.replace('.py', '.json');
                        globalThis.cy.elements().remove();
                        updateView();
                        loadCode(globalThis.activeName, undefined);
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

function getCallMap(node) {
    let callMap = {};

    Object.keys(node.content.FunctionCall).forEach(c => {
        Object.keys(node.content.FunctionDef).forEach(fd => {
            for (let i = 0; i < node.content.FunctionDef[fd]['lineno'].length; i++) {
                node.content.FunctionCall[c]['line_num'].forEach(ln => {
                    if (node.content.FunctionDef[fd]['lineno'][i] <= ln && node.content.FunctionDef[fd]['line-end'][i] >= ln) {
                        if (!callMap.hasOwnProperty(node.content.FunctionCall[c]['defined'] + '|' + c)) {
                            callMap[node.content.FunctionCall[c]['defined'] + '|' + c] = [];
                        }
                        callMap[node.content.FunctionCall[c]['defined'] + '|' + c].push(fd);
                    }
                });
            }
        });
    });

    return callMap;
}

function goToView() {
    let spin = document.getElementById('spinner');
    let sbbox = spin.getBoundingClientRect();
    spin.style.top = window.innerHeight / 2 - sbbox.height / 2;
    spin.style.left = window.innerWidth * 0.65 / 2 - sbbox.width / 2;

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
            globalThis.currSearchDepSet = {};
            globalThis.activeName = undefined;

            for (const k in globalThis.nodes) {
                computeDependencies(globalThis.nodes[k], globalThis.nodes);
            }
            computeFolderDependencies(root_node);
            for (const k in globalThis.nodes) {
                globalThis.nodes[k].originalDependents = globalThis.nodes[k].dependents;
            }
            for (const k in globalThis.nodes) {
                globalThis.nodes[k].dependents = augmentDependencySet(globalThis.nodes[k].dependents);
            }
            for (const k in globalThis.folders) {
                globalThis.folders[k].dependents = augmentDependencySet(globalThis.folders[k].dependents);
            }
            for (const k in globalThis.nodes) {
                globalThis.nodes[k].callMap = getCallMap(globalThis.nodes[k]);
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
                            'curve-style': 'bezier',
                        }
                    }

                ]
            });
            globalThis.cy.minZoom(0.03);
            globalThis.cy.maxZoom(8.5);
            globalThis.cy.on('zoom', updateGraphViewOnZoom);
            globalThis.nodesInView = [root_node];

            updateGraphViewOnZoom(undefined);
            globalThis.cy.zoom(0.2);
            updateSlider();
            globalThis.cy.center();

            document.getElementById('cy').style.visibility = 'visible';
            document.getElementById('spinner').remove();
        }
    }
    req.open('GET', 'http://localhost:5000/files');
    req.send();
}

function onClearSelection() {
    globalThis.cy.elements().remove();
    globalThis.cy.edges().style({ 'z-index': '0' });
    globalThis.activeName = undefined;
    updateView();
    globalThis.currSearchDepSet = {};
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