function postDataComplete() {
    document.getElementById('status').innerHTML = 'Done uploading';
    document.getElementById('pbar').innerHTML = '';
}

function finalizeUpload() {
    document.getElementById('status').innerHTML = 'Indexing...';
    let req = new XMLHttpRequest();
    req.onreadystatechange = function () {
        if (req.readyState == 4 && req.status == 200) {
            postDataComplete();
        }
    }
    req.open('POST', 'http://localhost:5000/postprocess');
    req.send();
}

function sendFile() {
    if (globalThis.requestQueue.length == 0) return;
    let r = new XMLHttpRequest();
    let formData = new FormData();
    r.onreadystatechange = function () {
        if (r.readyState == 4 && r.status == 200) {
            globalThis.recvCount++;
            document.getElementById('pbarv').value = globalThis.recvCount;

            if (globalThis.recvCount == document.getElementById('ctrl').files.length) {
                finalizeUpload();
            }
            else {
                sendFile();
            }
        }
    }

    formData.append("file", globalThis.requestQueue[0]);
    r.open("POST", 'http://localhost:5000/src');
    r.send(formData);

    globalThis.requestQueue.shift();
}

function onFolderSelect() {
    let req = new XMLHttpRequest();
    req.onreadystatechange = function () {
        if (req.readyState == 4 && req.status == 200) {
            globalThis.recvCount = 0;
            document.getElementById('status').innerHTML = 'Uploading...';
            document.getElementById('pbar').innerHTML =
                `<meter id='pbarv' min="0" max="${document.getElementById('ctrl').files.length}" value="0"></meter>`;

            globalThis.requestQueue = Array.from(document.getElementById('ctrl').files);
            for (let i = 0; i < 20; i++) {
                sendFile();
            }
        }
    }
    req.open('POST', 'http://localhost:5000/reset');
    req.send();
}