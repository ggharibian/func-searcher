import numpy as np
import os
import json

#OUTPUT_FOLDER = ''
def simrank(adj_mat, N):
    d12 = np.zeros((N, N))
    for i in range(N):
        d12[i][i] = 1 / (np.sqrt(np.sum(adj_mat[i])))
    nam = np.matmul(np.matmul(d12, adj_mat), d12)
    print(nam)


sim_mat = None
i_to_f = {}
f_to_id = {}
N = 0

def load_smat():
    global sim_mat
    global i_to_f
    global f_to_id
    global N
    sim_mat = np.load(os.path.join('./index/', "sim_mat.npy"))
    N = sim_mat.shape[0]
    with open(os.path.join('./index/', "file_key.txt")) as f:
        j = json.loads(f.read())
        i_to_f = j['id-to-f']
        f_to_id = j['f-to-id']

def get_similarity(OUTPUT_FOLDER, fname):
    global sim_mat
    global i_to_f
    global f_to_id
    global N
    try:
        tid = f_to_id[fname]
        mr = [(i, sim_mat[tid][i]) for i in range(N)]
        mr.sort(key=lambda x: -1*x[1])
        return [(i_to_f[f], c) for f, c in mr[1:6]]
    except Exception as e:
        print(e) # TODO: FIX!!!
        return []

if os.path.exists(os.path.join('./index/', "sim_mat.npy")):
    load_smat()

#get_similarity("scikit-learn/sklearn/linear_model/_linear_loss.json|weight_intercept")