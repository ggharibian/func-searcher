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

def get_similarity(OUTPUT_FOLDER, fname):
    sim_mat = np.load(os.path.join(OUTPUT_FOLDER, "sim_mat.npy"))
    N = sim_mat.shape[0]
    with open(os.path.join(OUTPUT_FOLDER, "file_key.txt")) as f:
        j = json.loads(f.read())
        i_to_f = j['id-to-f']
        f_to_id = j['f-to-id']
    tid = f_to_id[fname]
    mr = [(i, sim_mat[tid][i]) for i in range(N)]
    mr.sort(key=lambda x: -1*x[1])
    for f, c in mr[1:6]:
        print(i_to_f[f], c)
    return [(i_to_f[f], c) for f, c in mr[1:6]]

#get_similarity("scikit-learn/sklearn/linear_model/_linear_loss.json|weight_intercept")