/**
 * webrtc.js — EchoChat one-to-one video calling module
 *
 * Depends on:
 *   - socket (defined in the inline <script> in chat.ejs)
 *   - currentUsername (defined in the inline <script> in chat.ejs)
 *
 * Fixes addressed:
 *   1.  register-user emitted on load
 *   2.  socketUsers map managed on the server (see app.js)
 *   3.  call-user routes via server lookup
 *   4.  ice-candidate forwarded via server lookup
 *   5.  RTCPeerConnection created only at call-start / call-accept
 *   6.  ICE candidates queued until remoteDescription is set
 *   7.  All media tracks stopped on endCall
 *   8.  Disconnect cleanup handled on server
 *   9.  Incoming offer + caller stored until Accept clicked
 *  10.  call-ended forwarded to peer so both sides close
 *  OPT1. 30-second call timeout
 *  OPT2. in-call guard prevents duplicate calls
 *  OPT3. getUserMedia error handling
 */

/* ========================= State ========================= */
'use strict';

let peerConnection = null;      // RTCPeerConnection — only alive during a call
let localStream    = null;      // MediaStream from getUserMedia
let remoteUsername = null;      // username of the peer we are talking to
let isInCall       = false;     // OPT2: guard flag
let callTimeout    = null;      // OPT1: timeout handle

// OPT3 / Fix 9: store incoming offer + caller until accepted
let pendingOffer       = null;
let pendingCallerName  = null;

// Fix 6: ICE candidates queued before remote description is set
let iceCandidateQueue = [];

const STUN_CONFIG = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

/* ========================= DOM helpers ========================= */

const videoCallModal    = document.getElementById('videoCallModal');
const localVideo        = document.getElementById('localVideo');
const remoteVideo       = document.getElementById('remoteVideo');
const remoteWaiting     = document.getElementById('remoteWaiting');
const callStatusLabel   = document.getElementById('callStatusLabel');
const videoCallBtn      = document.getElementById('videoCallBtn');
const incomingCallBanner= document.getElementById('incomingCallBanner');
const incomingCallerText= document.getElementById('incomingCallerText');
const muteBtn           = document.getElementById('muteBtn');
const cameraBtn         = document.getElementById('cameraBtn');
const localVideoOff     = document.getElementById('localVideoOff');

function openModal() {
    videoCallModal.classList.add('active');
}
function closeModal() {
    videoCallModal.classList.remove('active');
}
function showBanner() {
    incomingCallBanner.classList.add('active');
}
function hideBanner() {
    incomingCallBanner.classList.remove('active');
}
function setStatus(text) {
    if (callStatusLabel) callStatusLabel.textContent = text;
}
function showRemoteWaiting(show) {
    if (remoteWaiting) remoteWaiting.style.display = show ? 'flex' : 'none';
}

/* ========================= Register on load (Fix 1) ========================= */

/**
 * Wait for socket to be available (it is defined in the inline script above
 * this file's <script> tag). We poll briefly to be safe.
 */
function registerUser() {
    if (typeof socket !== 'undefined' && typeof currentUsername !== 'undefined') {
        socket.emit('register-user', currentUsername);
    } else {
        setTimeout(registerUser, 100);
    }
}
registerUser();

/* ========================= RTCPeerConnection factory (Fix 5) ========================= */

/**
 * Creates a brand-new RTCPeerConnection with ICE event handlers wired up.
 * Called only when a call starts or is accepted — never on page load.
 */
function createPeerConnection(targetUsername) {
    const pc = new RTCPeerConnection(STUN_CONFIG);

    // Send our ICE candidates to the peer via server relay (Fix 4)
    pc.onicecandidate = ({ candidate }) => {
        if (candidate) {
            socket.emit('ice-candidate', { to: targetUsername, candidate });
        }
    };

    // When remote track arrives, attach to remoteVideo element
    pc.ontrack = ({ streams }) => {
        if (streams && streams[0]) {
            remoteVideo.srcObject = streams[0];
            showRemoteWaiting(false);
        }
    };

    // Connection state logging
    pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        setStatus(state.charAt(0).toUpperCase() + state.slice(1) + '…');
        if (state === 'connected') {
            setStatus('Connected ✓');
        } else if (state === 'failed' || state === 'disconnected') {
            setStatus('Connection lost. Ending call…');
            endCall();
        }
    };

    return pc;
}

/* ========================= Get user media (OPT3) ========================= */

async function getLocalStream() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        return stream;
    } catch (err) {
        let msg = 'Could not access camera/microphone.';
        if (err.name === 'NotAllowedError')  msg = 'Permission denied. Please allow camera & microphone access.';
        if (err.name === 'NotFoundError')    msg = 'No camera or microphone found on this device.';
        if (err.name === 'NotReadableError') msg = 'Camera or microphone is already in use.';
        alert(`EchoChat Video Call: ${msg}`);
        throw err;
    }
}

/* ========================= Caller side ========================= */

/**
 * Called when the user clicks the 📹 Video Call button.
 * Prompts for a recipient username, then initiates the WebRTC handshake.
 */
async function startCall() {
    // OPT2: guard — prevent duplicate calls
    if (isInCall) {
        alert('You are already in a call.');
        return;
    }

    const target = prompt('Enter the username of the person you want to call:');
    if (!target || target.trim() === '') return;
    if (target.trim() === currentUsername) {
        alert('You cannot call yourself.');
        return;
    }

    remoteUsername = target.trim();
    isInCall = true;
    videoCallBtn.disabled = true;

    // Show modal early so the user sees their own camera
    openModal();
    setStatus('Connecting…');
    showRemoteWaiting(true);

    try {
        // Fix 5: create peerConnection here, not on page load
        localStream = await getLocalStream();
        localVideo.srcObject = localStream;

        peerConnection = createPeerConnection(remoteUsername);

        // Add local tracks to the peer connection
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

        // Create offer
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        // Send offer to callee via server
        socket.emit('call-user', { to: remoteUsername, from: currentUsername, offer });

        setStatus(`Calling ${remoteUsername}…`);

        // OPT1: 30-second call timeout if callee doesn't respond
        callTimeout = setTimeout(() => {
            if (isInCall && !remoteVideo.srcObject) {
                setStatus('No answer. Ending call…');
                endCall();
            }
        }, 30000);

    } catch (err) {
        // getUserMedia error was already alerted inside getLocalStream()
        resetState();
    }
}

/* ========================= Callee side ========================= */

/**
 * Receives incoming SDP offer. Stores offer & caller name (Fix 9),
 * then shows the incoming call banner.
 */
socket.on('video-offer', ({ from, offer }) => {
    // OPT2: reject if already in a call
    if (isInCall) {
        socket.emit('call-rejected', { to: from });
        return;
    }

    // Fix 9: store pending offer and caller until user clicks Accept
    pendingOffer      = offer;
    pendingCallerName = from;

    incomingCallerText.textContent = `📹 ${from} is calling you…`;
    showBanner();
});

/**
 * User clicked Accept.
 */
async function acceptCall() {
    if (!pendingOffer || !pendingCallerName) return;

    hideBanner();
    remoteUsername = pendingCallerName;
    isInCall = true;
    videoCallBtn.disabled = true;

    openModal();
    setStatus('Connecting…');
    showRemoteWaiting(true);

    try {
        // Fix 5: create peerConnection only now
        localStream = await getLocalStream();
        localVideo.srcObject = localStream;

        peerConnection = createPeerConnection(remoteUsername);

        // Add our tracks
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

        // Set remote description from the stored offer (Fix 9)
        await peerConnection.setRemoteDescription(new RTCSessionDescription(pendingOffer));

        // Flush any ICE candidates that arrived before we set remoteDescription (Fix 6)
        for (const c of iceCandidateQueue) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(c));
        }
        iceCandidateQueue = [];

        // Create answer
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        socket.emit('video-answer', { to: remoteUsername, answer });

        pendingOffer      = null;
        pendingCallerName = null;

    } catch (err) {
        resetState();
    }
}

/**
 * User clicked Reject.
 */
function rejectCall() {
    hideBanner();
    socket.emit('call-rejected', { to: pendingCallerName });
    pendingOffer      = null;
    pendingCallerName = null;
}

/* ========================= Caller receives answer ========================= */

socket.on('video-answer', async ({ answer }) => {
    if (!peerConnection) return;
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));

        // Flush queued ICE candidates (Fix 6)
        for (const c of iceCandidateQueue) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(c));
        }
        iceCandidateQueue = [];

        setStatus('Call connected…');
    } catch (err) {
        console.error('Error setting remote description:', err);
    }
});

/* ========================= ICE candidate exchange (Fix 6) ========================= */

socket.on('ice-candidate', async ({ candidate }) => {
    if (!candidate) return;

    // Fix 6: queue if remoteDescription not yet set
    if (!peerConnection || !peerConnection.remoteDescription) {
        iceCandidateQueue.push(candidate);
        return;
    }
    try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
        console.warn('ICE candidate error:', err);
    }
});

/* ========================= Call rejected (caller side) ========================= */

socket.on('call-rejected', () => {
    alert(`${remoteUsername} rejected the call.`);
    resetState();
});

/* ========================= End call (Fix 7, Fix 10) ========================= */

/**
 * Called by the End Call button or programmatically.
 * Notifies the peer (Fix 10), stops all tracks (Fix 7), and resets state.
 */
function endCall() {
    if (remoteUsername) {
        socket.emit('call-ended', { to: remoteUsername });   // Fix 10
    }
    closeModal();
    resetState();
}

// Peer ended the call — both sides must close (Fix 10)
socket.on('call-ended', () => {
    closeModal();
    resetState();
});

/* ========================= Mute / Camera toggle ========================= */

function toggleMute() {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (!audioTrack) return;
    audioTrack.enabled = !audioTrack.enabled;
    muteBtn.classList.toggle('muted', !audioTrack.enabled);
    muteBtn.title = audioTrack.enabled ? 'Mute' : 'Unmute';
}

function toggleCamera() {
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    if (!videoTrack) return;
    videoTrack.enabled = !videoTrack.enabled;
    const off = !videoTrack.enabled;
    cameraBtn.classList.toggle('off', off);
    localVideo.style.display = off ? 'none' : 'block';
    if (localVideoOff) localVideoOff.classList.toggle('active', off);
    cameraBtn.title = off ? 'Turn Camera On' : 'Turn Camera Off';
}

/* ========================= State reset (Fix 7) ========================= */

/**
 * Stops all media tracks, closes peer connection, and resets every state
 * variable to its initial value. Called after every call end scenario.
 */
function resetState() {
    // Fix 7: stop ALL local media tracks
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    // Close peer connection
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    // Clear video elements
    localVideo.srcObject  = null;
    remoteVideo.srcObject = null;

    // Clear timeout (OPT1)
    if (callTimeout) {
        clearTimeout(callTimeout);
        callTimeout = null;
    }

    // Reset UI
    showRemoteWaiting(true);
    setStatus('');
    if (muteBtn)  muteBtn.classList.remove('muted');
    if (cameraBtn) cameraBtn.classList.remove('off');
    if (localVideo) localVideo.style.display = 'block';
    if (localVideoOff) localVideoOff.classList.remove('active');

    // Reset state variables
    remoteUsername    = null;
    isInCall          = false;
    iceCandidateQueue = [];
    pendingOffer      = null;
    pendingCallerName = null;

    // Re-enable call button
    if (videoCallBtn) videoCallBtn.disabled = false;
}
