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

        float depth = texture2D(u_depthMap, uv).r;
        vec2 parallax = u_mouse * (depth - 0.5) * 0.05;
        
        // Add a slight zoom to prevent tearing on edges during parallax
        uv = uv * 0.95 + 0.025; 

        gl_FragColor = texture2D(u_image, uv + parallax);
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
    -1, -1,  1, -1, -1,  1,
    -1,  1,  1, -1,  1,  1
]), gl.STATIC_DRAW);

const positionLoc = gl.getAttribLocation(program, "a_position");
gl.enableVertexAttribArray(positionLoc);
gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

let imgWidth = 1, imgHeight = 1;

function loadTexture(url, unit, isMain) {
    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0,0,0,0]));
    
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

loadTexture('imgs/bg_img.png', 0, true);
loadTexture('imgs/bg_depth.png', 1, false);

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

window.addEventListener('deviceorientation', (e) => {
    if (e.gamma !== null && e.beta !== null) {
        // High sensitivity for mobile tilts
        let x = e.gamma / 25.0; 
        let y = (e.beta - 45.0) / 25.0; // Assume 45 deg as neutral holding pos
        x = Math.max(-1.5, Math.min(1.5, x));
        y = Math.max(-1.5, Math.min(1.5, y));

        targetX = x * 3.0; 
        targetY = y * 3.0;
        hasGyro = true;
    }
}, true);

window.addEventListener('mousemove', (e) => {
    if (hasGyro) return;
    targetX = (e.clientX / window.innerWidth - 0.5) * 2.0;
    targetY = -(e.clientY / window.innerHeight - 0.5) * 2.0;
});

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
