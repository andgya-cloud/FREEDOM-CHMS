import sys
from PIL import Image, ImageDraw
fs=sys.argv[2:]; W=280
ims=[]
for f in fs:
    i=Image.open(f); w=W if i.width<1000 else W*2
    i=i.resize((w,int(i.height*w/i.width))); ims.append((f,i))
H=min(max(i.height for _,i in ims),1300)+20
tot=sum(i.width+8 for _,i in ims)
sh=Image.new('RGB',(tot,H),'white'); d=ImageDraw.Draw(sh); x=0
for f,i in ims:
    sh.paste(i.crop((0,0,i.width,min(i.height,H-20))),(x,20)); d.text((x+4,4),f.split('/')[-1],fill='black'); x+=i.width+8
sh.save(sys.argv[1])
