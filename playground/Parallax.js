const canvas = document.getElementById('playground-canvas');
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

function getFsSource(algo, iterations) {
    let coreLogic = '';
    
    if (algo === '1') {
        coreLogic = `
            float depth = texture2D(u_depthMap, uv).r;
            vec2 p = uv + offset * (depth - u_focusPlane);
        `;
    } else if (algo === '2') {
        coreLogic = `
            float d0 = texture2D(u_depthMap, uv).r;
            float d1 = texture2D(u_depthMap, uv + vec2(0.003, 0.0)).r;
            float d2 = texture2D(u_depthMap, uv - vec2(0.003, 0.0)).r;
            float d3 = texture2D(u_depthMap, uv + vec2(0.0, 0.003)).r;
            float d4 = texture2D(u_depthMap, uv - vec2(0.0, 0.003)).r;
            float smoothDepth = (d0 + d1 + d2 + d3 + d4) / 5.0;
            vec2 p = uv + offset * (smoothDepth - u_focusPlane);
        `;
    } else if (algo === '3') {
        coreLogic = `
            float depth1 = texture2D(u_depthMap, uv).r;
            vec2 half_offset = offset * (depth1 - u_focusPlane) * 0.5;
            float depth2 = texture2D(u_depthMap, uv + half_offset).r;
            vec2 p = uv + offset * (depth2 - u_focusPlane);
        `;
    } else if (algo === '4') {
        coreLogic = `
            vec2 p = uv;
            for (int i = 0; i < ${iterations}; i++) {
                float d = texture2D(u_depthMap, p).r;
                vec2 target_p = uv + offset * (d - u_focusPlane);
                p = mix(p, target_p, 0.6);
            }
        `;
    } else if (algo === '5') {
        coreLogic = `
            vec2 p = uv;
            float layerDepth = 1.0;
            float stepSize = 1.0 / float(${iterations});
            vec2 deltaTex = offset * stepSize;
            p -= offset * (1.0 - u_focusPlane); 
            for(int i = 0; i < ${iterations}; i++) {
                float d = texture2D(u_depthMap, p).r;
                if(d < layerDepth) {
                    p += deltaTex;
                    layerDepth -= stepSize;
                }
            }
        `;
    } else if (algo === '6') {
        coreLogic = `
            vec2 p = uv;
            float max_d = 0.0;
            for(int i = 0; i <= ${iterations}; i++) {
                float t = float(i) / float(${iterations});
                vec2 test_p = uv + offset * (t - u_focusPlane);
                float d = texture2D(u_depthMap, test_p).r;
                if(d > max_d) { max_d = d; p = test_p; }
            }
        `;
    }

    return `
        precision mediump float;
        uniform sampler2D u_image;
        uniform sampler2D u_depthMap;
        uniform vec2 u_mouse;
        uniform vec2 u_resolution;
        uniform vec2 u_imageSize;
        
        uniform float u_intensity;
        uniform float u_zoom;
        uniform float u_aberration;
        uniform float u_focusPlane;
        uniform int u_debugDepth;

        varying vec2 v_texCoord;

        void main() {
            vec2 ratio = vec2(
                min((u_resolution.x / u_resolution.y) / (u_imageSize.x / u_imageSize.y), 1.0),
                min((u_resolution.y / u_resolution.x) / (u_imageSize.y / u_imageSize.x), 1.0)
            );
            vec2 uv = v_texCoord * ratio + (1.0 - ratio) * 0.5;
            
            // Zoom logic
            float shiftAmt = (1.0 - u_zoom) * 0.5;
            uv = uv * u_zoom + shiftAmt; 

            vec2 offset = u_mouse * u_intensity;

            // --- INJECTED CORE LOGIC ---
            ${coreLogic}
            // ---------------------------

            if (u_debugDepth == 1) {
                float d = texture2D(u_depthMap, uv).r;
                gl_FragColor = vec4(d, d, d, 1.0);
            } else if (u_aberration > 0.0) {
                float r = texture2D(u_image, p + (u_mouse * u_aberration)).r;
                float g = texture2D(u_image, p).g;
                float b = texture2D(u_image, p - (u_mouse * u_aberration)).b;
                gl_FragColor = vec4(r, g, b, 1.0);
            } else {
                gl_FragColor = texture2D(u_image, p);
            }
        }
    `;
}

function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(shader));
    }
    return shader;
}

let program;
let positionBuffer;
let positionLoc;

let imageUnif, depthUnif, mouseUnif, resUnif, sizeUnif, intensityUnif, zoomUnif, aberrationUnif, focusPlaneUnif, debugDepthUnif;

function initShaders() {
    const algo = document.getElementById('algo').value;
    const iterations = document.getElementById('iterations').value;
    
    const fsSource = getFsSource(algo, iterations);

    if (program) {
        gl.deleteProgram(program);
    }
    program = gl.createProgram();
    gl.attachShader(program, createShader(gl, gl.VERTEX_SHADER, vsSource));
    gl.attachShader(program, createShader(gl, gl.FRAGMENT_SHADER, fsSource));
    gl.linkProgram(program);
    gl.useProgram(program);

    if (!positionBuffer) {
        positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1, 1, -1, -1, 1,
            -1, 1, 1, -1, 1, 1
        ]), gl.STATIC_DRAW);
    }

    positionLoc = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(positionLoc);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

    imageUnif = gl.getUniformLocation(program, "u_image");
    depthUnif = gl.getUniformLocation(program, "u_depthMap");
    mouseUnif = gl.getUniformLocation(program, "u_mouse");
    resUnif = gl.getUniformLocation(program, "u_resolution");
    sizeUnif = gl.getUniformLocation(program, "u_imageSize");
    intensityUnif = gl.getUniformLocation(program, "u_intensity");
    zoomUnif = gl.getUniformLocation(program, "u_zoom");
    aberrationUnif = gl.getUniformLocation(program, "u_aberration");
    focusPlaneUnif = gl.getUniformLocation(program, "u_focusPlane");
    debugDepthUnif = gl.getUniformLocation(program, "u_debugDepth");

    gl.uniform1i(imageUnif, 0);
    gl.uniform1i(depthUnif, 1);
}

let imgWidth = 1, imgHeight = 1;
let colorTex, depthTex;

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
    return texture;
}

function loadDefaultImages() {
    colorTex = loadTexture('../imgs/bg_img.jpg', 0, true);
    depthTex = loadTexture('../imgs/bg_depth.jpg', 1, false);
}

let mouseX = 0, mouseY = 0;
let targetX = 0, targetY = 0;
let hasGyro = false;

function smoothEdge(val) {
    let limitEnabled = document.getElementById('softLimits').checked;
    if (!limitEnabled) return val;
    // Справжнє жорстке гасіння по краях.
    // Замість досягнення 1.0 (що викликає зріз текстури), ми максимум виводимо 0.85
    return Math.sign(val) * Math.min(Math.abs(val), 0.85); 
}

function processInput(x, y) {
    let invert = document.getElementById('invertMouse').checked ? -1 : 1;
    targetX = smoothEdge(x) * 1.5 * invert;
    targetY = smoothEdge(y) * 1.5 * invert;
}

window.addEventListener('mousemove', (e) => {
    if (hasGyro) return;
    let rawX = (e.clientX / window.innerWidth - 0.5) * 2.0;
    let rawY = -(e.clientY / window.innerHeight - 0.5) * 2.0;
    processInput(rawX, rawY);
});

function getOrientation() {
    return (screen.orientation || {}).angle || window.orientation || 0;
}

window.addEventListener('deviceorientation', (e) => {
    if (e.gamma !== null && e.beta !== null) {
        let x = 0;
        let y = 0;
        const angle = getOrientation();
        if (angle === 90) {
            x = e.beta; y = -e.gamma - 45.0;
        } else if (angle === -90 || angle === 270) {
            x = -e.beta; y = e.gamma - 45.0;
        } else if (angle === 180) {
            x = -e.gamma; y = -e.beta - 45.0;
        } else {
            x = e.gamma; y = e.beta - 45.0;
        }
        x = x / 25.0;
        y = y / 25.0;
        
        // Гіроскоп теж підпадає під Invert та спільний алгоритм лімітів
        let invert = document.getElementById('invertMouse').checked ? -1 : 1;
        let limitEnabled = document.getElementById('softLimits').checked;
        
        if (limitEnabled) {
            targetX = Math.tanh(x) * 1.8 * invert;
            targetY = Math.tanh(y) * 1.8 * invert;
        } else {
            targetX = Math.max(-1.5, Math.min(1.5, x)) * 3.0 * invert;
            targetY = Math.max(-1.5, Math.min(1.5, y)) * 3.0 * invert;
        }
        hasGyro = true;
    }
}, true);

window.addEventListener('touchmove', (e) => {
    if (hasGyro) return;
    let rawX = (e.touches[0].clientX / window.innerWidth - 0.5) * 2.0;
    let rawY = -(e.touches[0].clientY / window.innerHeight - 0.5) * 2.0;
    processInput(rawX, rawY);
}, {passive: true});

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);
}
window.addEventListener('resize', resize);
resize();

let lastTime = performance.now();
let frameCount = 0;

function render(time) {
    // Обчислення FPS
    frameCount++;
    if (time - lastTime >= 1000) {
        document.getElementById('fpsCounter').innerText = frameCount + ' FPS';
        document.getElementById('frameTime').innerText = (1000 / frameCount).toFixed(1) + 'ms';
        frameCount = 0;
        lastTime = time;
    }

    mouseX += (targetX - mouseX) * 0.05;
    mouseY += (targetY - mouseY) * 0.05;

    gl.useProgram(program);
    gl.uniform2f(mouseUnif, mouseX, mouseY);
    gl.uniform2f(resUnif, canvas.width, canvas.height);
    gl.uniform2f(sizeUnif, imgWidth, imgHeight);
    
    // UI Readouts
    let guiIntensity = parseFloat(document.getElementById('intensity').value);
    let guiZoom = parseFloat(document.getElementById('zoom').value);
    let guiAberration = parseFloat(document.getElementById('aberration').value);
    let guiFocusPlane = parseFloat(document.getElementById('focusPlane').value);
    let guiDebugDepth = document.getElementById('debugDepth').checked ? 1 : 0;
    
    gl.uniform1f(intensityUnif, guiIntensity);
    gl.uniform1f(zoomUnif, guiZoom);
    gl.uniform1f(aberrationUnif, guiAberration);
    gl.uniform1f(focusPlaneUnif, guiFocusPlane);
    gl.uniform1i(debugDepthUnif, guiDebugDepth);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    requestAnimationFrame(render);
}

// UI Listeners
document.getElementById('algo').addEventListener('change', () => {
    let algo = document.getElementById('algo').value;
    document.getElementById('iterContainer').style.opacity = (algo >= '4') ? '1' : '0.2';
    initShaders();
});
document.getElementById('iterations').addEventListener('input', (e) => {
    document.getElementById('iterationsVal').innerText = e.target.value;
    let algo = document.getElementById('algo').value;
    if (algo >= '4') initShaders();
});
document.getElementById('intensity').addEventListener('input', (e) => document.getElementById('intensityVal').innerText = e.target.value);
document.getElementById('zoom').addEventListener('input', (e) => document.getElementById('zoomVal').innerText = e.target.value);
document.getElementById('aberration').addEventListener('input', (e) => document.getElementById('aberrationVal').innerText = e.target.value);
document.getElementById('focusPlane').addEventListener('input', (e) => document.getElementById('focusPlaneVal').innerText = e.target.value);

// File Uploads
document.getElementById('uploadColorBtn').addEventListener('click', () => document.getElementById('colorInput').click());
document.getElementById('uploadDepthBtn').addEventListener('click', () => document.getElementById('depthInput').click());

document.getElementById('colorInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) loadTexture(URL.createObjectURL(file), 0, true);
});
document.getElementById('depthInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) loadTexture(URL.createObjectURL(file), 1, false);
});
document.getElementById('resetImagesBtn').addEventListener('click', () => {
    loadDefaultImages();
    document.getElementById('colorInput').value = '';
    document.getElementById('depthInput').value = '';
});

// Init
initShaders();
loadDefaultImages();
render();
