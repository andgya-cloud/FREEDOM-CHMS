import glob, os
from PIL import Image
os.makedirs('/home/user/manual/shots/j', exist_ok=True)
for f in glob.glob('/home/user/manual/shots/m/*.png'):
    im = Image.open(f).convert('RGB')
    if im.width > 1400: im = im.resize((1400, int(im.height * 1400 / im.width)), Image.LANCZOS)
    im.save('/home/user/manual/shots/j/' + os.path.basename(f)[:-4] + '.jpg', quality=82, optimize=True)
