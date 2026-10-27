import os,sys,json; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
# usage: python tools_check_composites.py instance.json composites.json (each composite alone, spacing check)
from nestprep.solution import validate
from nestprep.geom import Xf
inst=json.load(open(sys.argv[1])); mp=json.load(open(sys.argv[2]))
# put every composite alone on a virtual sheet and validate spacing only
for k,e in enumerate(mp['item_types']):
    if e['kind']=='original': continue
    parts=[{"orig_type":m['orig_type'],"xf":Xf(m['angle'],m['mirror'],m['x']+1e5,m['y']+1e5),"depth":m['depth'],"group":0} for m in e['members']]
    big=dict(inst); big=json.loads(json.dumps(inst)); big['bin_types']=[{"type":"rectangle","width":1e6,"height":1e6}]
    v=validate(big,[{"bin_type":0,"parts":parts}])
    errs=[x for x in v['errors'] if 'placed' not in x]
    print(e['label'], 'OK' if not errs else errs[:3], round(v['min_gap'],2))
