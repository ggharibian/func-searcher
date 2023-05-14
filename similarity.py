import numpy as np
import os
import json
from scipy import spatial

#OUTPUT_FOLDER = ''
def simrank(adj_mat, N):
    d12 = np.zeros((N, N))
    for i in range(N):
        d12[i][i] = 1 / (np.sqrt(np.sum(adj_mat[i])))
    nam = np.matmul(np.matmul(d12, adj_mat), d12)
    print(nam)


fname_mat = None
i_to_f = {}
f_to_id = {}
N = 0

def load_smat():
    global fname_mat
    global i_to_f
    global f_to_id
    global N
    global name_tree
    fname_mat = np.load(os.path.join('./index/', "fname_mat.npy"))
    N = fname_mat.shape[0]
    name_tree = spatial.KDTree(fname_mat)
    with open(os.path.join('./index/', "file_key.txt")) as f:
        j = json.loads(f.read())
        i_to_f = j['id-to-f']
        f_to_id = j['f-to-id']

def get_similarity(OUTPUT_FOLDER, fname):
    global fname_mat
    global i_to_f
    global f_to_id
    global N
    global name_tree
    try:
        lookup = fname_mat[f_to_id[fname]]
        return [i_to_f[id] for id in name_tree.query(lookup, k=6)[1][1:]]
    except Exception as e:
        print(e) # TODO: FIX!!!
        return []

if os.path.exists(os.path.join('./index/', "fname_mat.npy")):
    load_smat()

#get_similarity("scikit-learn/sklearn/linear_model/_linear_loss.json|weight_intercept")