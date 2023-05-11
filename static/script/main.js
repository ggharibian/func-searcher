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

function onFolderSelect() {
    let req = new XMLHttpRequest();
    req.onreadystatechange = function () {
        if (req.readyState == 4 && req.status == 200) {
            globalThis.recvCount = 0;
            document.getElementById('status').innerHTML = 'Uploading...';
            document.getElementById('pbar').innerHTML =
                `<meter id='pbarv' min="0" max="${document.getElementById('ctrl').files.length}" value="0"></meter>`
            Array.from(document.getElementById('ctrl').files).forEach(e => {
                let r = new XMLHttpRequest();
                let formData = new FormData();

                r.onreadystatechange = function () {
                    if (r.readyState == 4 && r.status == 200) {
                        globalThis.recvCount++;
                        document.getElementById('pbarv').value = globalThis.recvCount;

                        if (globalThis.recvCount == document.getElementById('ctrl').files.length) {
                            finalizeUpload();
                        }
                    }
                    else if (r.readyState == 4 && r.status != 304) {
                        alert('Request failed');
                    }
                }

                formData.append("file", e);
                r.open("POST", 'http://localhost:5000/src');
                r.send(formData);
            });
        }
    }
    req.open('POST', 'http://localhost:5000/reset');
    req.send();
}