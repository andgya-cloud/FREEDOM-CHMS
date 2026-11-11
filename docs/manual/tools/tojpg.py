import glob, os
from PIL import Image
os.makedirs('/home/user/manual/shots/j', exist_ok=True)
for f in glob.glob('/home/user/manual/shots/m/*.png'):
    im = Image.open(f).convert('RGB')
    W = 1100 if im.width < 1000 * 2 else 1600
    if im.width > W: im = im.resize((W, int(im.height * W / im.width)), Image.LANCZOS)
    im.save('/home/user/manual/shots/j/' + os.path.basename(f)[:-4] + '.jpg', quality=74, optimize=True)
