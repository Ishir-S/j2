@echo off
if not exist "assets\textures" mkdir "assets\textures"

echo Downloading solar system and planetary textures...

curl -s -L -o "assets\textures\sun_lava.jpg" "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/lava/lavatile.jpg"
curl -s -L -o "assets\textures\earth.jpg" "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/earth_atmos_2048.jpg"
curl -s -L -o "assets\textures\earth_lights.png" "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/earth_lights_2048.png"
curl -s -L -o "assets\textures\earth_specular.jpg" "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/earth_specular_2048.jpg"
curl -s -L -o "assets\textures\earth_normal.jpg" "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/earth_normal_2048.jpg"
curl -s -L -o "assets\textures\moon.jpg" "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/moon_1024.jpg"

echo All texture files saved in assets\textures\
