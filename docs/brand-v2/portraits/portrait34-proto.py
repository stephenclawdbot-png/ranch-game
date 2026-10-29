import numpy as np, colorsys, sys
from PIL import Image
R='/home/user/ranch-game/apps/web/public/art/portraits/horse-%s.png'
L={f:np.array(Image.open(R%f).convert('RGBA')).astype(int) for f in ['bay','chestnut','black','palomino','grey','roan','buckskin','dark_bay','liver_chestnut','dapple_grey']}
A=L['bay'][:,:,3]>0
# fixed pixels (bridle, eye, outline): nearly identical across all coats
stack=np.stack([L[f][:,:,:3] for f in L]); spread=stack.max(0)-stack.min(0)
fixed=A&(spread.max(-1)<28)
# mane: dark in bay & black, but light in palomino (flaxen) and red in chestnut
def lum(a): return (0.3*a[...,0]+0.59*a[...,1]+0.11*a[...,2])
bay,pal,che=L['bay'],L['palomino'],L['chestnut']
maneM=A&~fixed&(lum(bay[...,:3])<60)&(lum(pal[...,:3])>150)&((pal[...,2]-pal[...,0])>-60)
# palomino: mane is low-saturation cream vs gold body
def sat(a):
  mx=a[...,:3].max(-1); mn=a[...,:3].min(-1); return (mx-mn)/np.maximum(mx,1)
maneM=A&~fixed&(sat(pal)<0.30)&(lum(pal[...,:3])>120)
# muzzle: in bay, low saturation greyish but not mane and lower-left region
yy,xx=np.mgrid[0:128,0:128]
muz=A&~fixed&~maneM&(sat(bay)<0.32)&(xx<60)&(yy>60)
body=A&~fixed&~maneM&~muz
g=lum(L['grey'][...,:3])
def level(mask):
  v=g[mask]; lo,hi=np.percentile(v,3),np.percentile(v,97); return np.clip((g-lo)/(hi-lo),0,1)
lb,lm=level(body),level(maneM)
def hx(h): h=h.lstrip('#'); return np.array([int(h[i:i+2],16) for i in (0,2,4)],float)
def ramp(t,shade,base,hi):
  t=t[...,None]; s,b,h=hx(shade),hx(base),hx(hi)
  dk=s*0.55
  return np.where(t<0.25,dk+(s-dk)*(t/0.25),np.where(t<0.6,s+(b-s)*((t-0.25)/0.35),b+(h-b)*((t-0.6)/0.4)))
def render(name,p,face=None,roan=False,eye=None):
  out=L['bay'].copy().astype(float)
  cb=ramp(lb,p['shade'],p['body'],p['hi']); cm=ramp(lm,p['mane'] if lum(hx(p['mane'])[None])[0]>100 else '#000000',p['mane'],p['manehi'])
  cz=ramp(lb,p['muzzle'],p['muzzle'],p['shade'])
  out[...,:3]=np.where(body[...,None],cb,out[...,:3]); out[...,:3]=np.where(maneM[...,None],cm,out[...,:3]); out[...,:3]=np.where(muz[...,None],cz*0.9+cb*0.1,out[...,:3])
  if roan:
    rng=(np.sin(xx*12.9898+yy*78.233)*43758.5453)%1
    m=body&(rng>0.62)&(yy>40); out[...,:3]=np.where(m[...,None],out[...,:3]*0.5+255*0.5,out[...,:3])
  if face=='blaze':
    # stripe down the face front: centred line from forehead to nose (3/4 view, follows bay star position)
    for y in range(34,96):
      cx=int(52-(y-34)*0.42); w=3 if y<80 else 5
      for x in range(cx-w,cx+w):
        if body[y,x] or muz[y,x]: out[y,x,:3]=np.array([243,240,232])*(0.85+0.15*lb[y,x])
  img=Image.fromarray(np.clip(out,0,255).astype(np.uint8),'RGBA')
  return img
P={
 'Bay':dict(body='#8a4527',shade='#5a2a16',hi='#b5683d',mane='#17100d',manehi='#3a2a22',muzzle='#3a2c26'),
 'Cremello':dict(body='#efe4c8',shade='#d2c3a0',hi='#fbf4e2',mane='#f6efdd',manehi='#fffaf0',muzzle='#d9a99a'),
 'Grullo':dict(body='#8e857a',shade='#625a51',hi='#aea598',mane='#1c1a18',manehi='#3a3632',muzzle='#2a2624'),
 'Red dun':dict(body='#d19a68',shade='#a46f43',hi='#e8b98a',mane='#8a4a2a',manehi='#b06a40',muzzle='#6a4a3a'),
 'Buckskin':dict(body='#c9a063',shade='#94713b',hi='#e2bf82',mane='#1a1410',manehi='#3a2e26',muzzle='#3a2c26'),
 'Smoky black':dict(body='#3a302a',shade='#221c19',hi='#5d4d43',mane='#120f0e',manehi='#2e2824',muzzle='#1e1a18'),
}
cells=[('Bay',{} ),('Bay + blaze',dict(face='blaze')),('Cremello',{}),('Grullo',{}),('Red dun',{}),('Buckskin',{}),('Smoky black',{}),('Blue roan',dict(roan=True))]
S=2;W=128*S
out=Image.new('RGBA',(W*4,W*2),(40,30,25,255))
for i,(n,kw) in enumerate(cells):
  key='Smoky black' if n=='Blue roan' else n.split(' +')[0]
  p=dict(P[key]); 
  if n=='Blue roan': p.update(body='#2a2626',shade='#151212',hi='#4a4442')
  im=render(n,p,**kw).resize((W,W),Image.NEAREST); out.alpha_composite(im,((i%4)*W,(i//4)*W))
out.save('proto.png')
m=np.zeros((128,128,3),np.uint8); m[body]=(160,80,40); m[maneM]=(20,20,20); m[muz]=(200,120,160); m[fixed]=(60,160,220)
Image.fromarray(m).resize((256,256),Image.NEAREST).save('roles.png')
print(body.sum(),maneM.sum(),muz.sum(),fixed.sum())
