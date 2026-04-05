const canvas = document.getElementById('bg-canvas');
const gl = canvas.getContext('webgl');

const vsSource = `
    attribute vec2 a_position;
    varying vec2 v_texCoord;
    void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        v_texCoord = a_position * 0.5 + 0.5;
        v_texCoord.y = 1.0 - v_texCoord.y;
    }
`;

const fsSource = `
    precision mediump float;
    uniform sampler2D u_image;
    uniform sampler2D u_depthMap;
    uniform vec2 u_mouse;
    uniform vec2 u_resolution;
    uniform vec2 u_imageSize;
    varying vec2 v_texCoord;

    void main() {
        vec2 ratio = vec2(
            min((u_resolution.x / u_resolution.y) / (u_imageSize.x / u_imageSize.y), 1.0),
            min((u_resolution.y / u_resolution.x) / (u_imageSize.y / u_imageSize.x), 1.0)
        );
        vec2 uv = v_texCoord * ratio + (1.0 - ratio) * 0.5;
        
        // Зум 0.8 (щоб сховати краї при сильному кадруванні)
        uv = uv * 0.8 + 0.1; 

        // Ітеративний паралакс (Fixed-Point Iteration)
        vec2 p = uv;
        vec2 max_offset = u_mouse * 0.04; // Інтенсивність 0.04

        // 15 кроків для максимальної якості фіксації текстури
        for (int i = 0; i < 15; i++) {
            float d = texture2D(u_depthMap, p).r;
            // Focal Plane = 1 (Передній план залишається повністю статичним, задні шари "пливуть")
            vec2 target_p = uv + max_offset * (d - 1.0);
            p = mix(p, target_p, 0.6); 
        }

        gl_FragColor = texture2D(u_image, p);
    }
`;

function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
}

const program = gl.createProgram();
gl.attachShader(program, createShader(gl, gl.VERTEX_SHADER, vsSource));
gl.attachShader(program, createShader(gl, gl.FRAGMENT_SHADER, fsSource));
gl.linkProgram(program);
gl.useProgram(program);

const positionBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1, 1, -1, -1, 1,
    -1, 1, 1, -1, 1, 1
]), gl.STATIC_DRAW);

const positionLoc = gl.getAttribLocation(program, "a_position");
gl.enableVertexAttribArray(positionLoc);
gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

let imgWidth = 1, imgHeight = 1;

function loadTexture(url, unit, isMain) {
    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));

    const image = new Image();
    image.src = url;
    image.onload = () => {
        if (isMain) {
            imgWidth = image.width;
            imgHeight = image.height;
        }
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    };
}

loadTexture('imgs/bg_img.jpg', 0, true);
loadTexture('imgs/bg_depth.jpg', 1, false);

const imageUnif = gl.getUniformLocation(program, "u_image");
const depthUnif = gl.getUniformLocation(program, "u_depthMap");
const mouseUnif = gl.getUniformLocation(program, "u_mouse");
const resUnif = gl.getUniformLocation(program, "u_resolution");
const sizeUnif = gl.getUniformLocation(program, "u_imageSize");

gl.uniform1i(imageUnif, 0);
gl.uniform1i(depthUnif, 1);

let mouseX = 0, mouseY = 0;
let targetX = 0, targetY = 0;
let hasGyro = false;

function getOrientation() {
    return (screen.orientation || {}).angle || window.orientation || 0;
}

window.addEventListener('deviceorientation', (e) => {
    if (e.gamma !== null && e.beta !== null) {
        let x = 0;
        let y = 0;

        // Handle tablet/phone landscape orientation swapping axes
        const angle = getOrientation();
        if (angle === 90) {
            x = e.beta;
            y = -e.gamma - 45.0;
        } else if (angle === -90 || angle === 270) {
            x = -e.beta;
            y = e.gamma - 45.0;
        } else if (angle === 180) {
            x = -e.gamma;
            y = -e.beta - 45.0;
        } else {
            // Portrait (0)
            x = e.gamma;
            y = e.beta - 45.0; // Assume 45 deg as neutral holding pos
        }
        
        x = x / 25.0;
        y = y / 25.0;

        // Плавне обмеження (Soft Clipping) для гіроскопа
        // Math.tanh плавно гасить значення при сильних нахилах, не даючи йому перевищити задану межу
        targetX = Math.tanh(x) * 2.0;
        targetY = Math.tanh(y) * 2.0;
        hasGyro = true;
    }
}, true);

// Функція плавного уповільнення на краях екрану (Quadratic Ease Out)
function smoothEdge(val) {
    let abs = Math.min(Math.abs(val), 1.0);
    let smoothed = 1.0 - Math.pow(1.0 - abs, 2.0);
    return Math.sign(val) * smoothed;
}

window.addEventListener('mousemove', (e) => {
    if (hasGyro) return;
    let rawX = (e.clientX / window.innerWidth - 0.5) * 2.0;
    let rawY = -(e.clientY / window.innerHeight - 0.5) * 2.0;
    // Множник 1.5 задає загальну інтенсивність, але на краях рух плавно зупиниться
    targetX = smoothEdge(rawX) * 1.5;
    targetY = smoothEdge(rawY) * 1.5;
});

// Fallback for iOS/Touch devices where gyro is blocked by permissions
window.addEventListener('touchmove', (e) => {
    if (hasGyro) return;
    let rawX = (e.touches[0].clientX / window.innerWidth - 0.5) * 2.0;
    let rawY = -(e.touches[0].clientY / window.innerHeight - 0.5) * 2.0;
    targetX = smoothEdge(rawX) * 1.5;
    targetY = smoothEdge(rawY) * 1.5;
}, {passive: true});

// Запрос дозволу для гіроскопа на iOS 13+ після першого дотику до екрану
document.body.addEventListener('click', () => {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission()
            .then(permissionState => {
                if (permissionState === 'granted') {
                    console.log('Gyro permission granted');
                }
            })
            .catch(console.error);
    }
}, { once: true });

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);
}
window.addEventListener('resize', resize);
resize();

function render() {
    mouseX += (targetX - mouseX) * 0.05;
    mouseY += (targetY - mouseY) * 0.05;

    gl.uniform2f(mouseUnif, mouseX, mouseY);
    gl.uniform2f(resUnif, canvas.width, canvas.height);
    gl.uniform2f(sizeUnif, imgWidth, imgHeight);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    requestAnimationFrame(render);
}
render();
