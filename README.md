# EchoChat - Comprehensive Project Documentation

EchoChat is a modern, real-time web chat and video calling application built on a robust MVC architecture using the Node.js ecosystem. It provides fully isolated, secure text and video communication environments through a sophisticated "Rooms" system.

---

## 🛠️ Tech Stack
*   **Backend:** Node.js, Express.js
*   **Database:** MongoDB, Mongoose (ODM)
*   **Authentication & Sessions:** `express-session`, `connect-mongo`, `bcryptjs`
*   **Real-time Communication:** Socket.io (for text routing & presence), WebRTC (for peer-to-peer video streams)
*   **Frontend UI:** EJS (Embedded JavaScript templating), Tailwind CSS (via CDN), Vanilla HTML/JS/CSS

---

## ✨ Core Features & Working Flow

### 1. Robust Authentication System
*   **Flow:** Users cannot access the app without an account. New users sign up via `/signup`, providing a unique username, email, and password. Returning users log in via `/login`.
*   **Security:** Passwords are never stored in plain text. A `pre('save')` hook in the MongoDB `User` model hashes incoming passwords using `bcryptjs`.
*   **Sessions:** Authentication state is persisted securely using `express-session` backed by a MongoDB store (`connect-mongo`).

### 2. Secure Room Management
*   **Concept:** There is no "global" chat. All communication happens inside isolated namespaces called Rooms.
*   **Creation & Ownership:** Any authenticated user can create a Room from the `/lobby` dashboard. The creator is permanently assigned as the Room `admin`.
*   **Access Control (Join Requests):** Users cannot simply walk into rooms. They must click "Request Join". This places them into a pending `joinRequests` array. The Room Admin sees these requests in real-time on their sidebar and must explicitly click "Approve" to move the user into the `members` array.
*   **Middleware Protection:** Backend routes (`/rooms/:id/chat`) are guarded by `requireRoomMember` middleware. If an unapproved user attempts to force-navigate to a room URL, they are immediately redirected away.

### 3. Real-Time Scoped Chat
*   **WebSockets:** Chat relies on Socket.io. When a user enters a room, their socket executes `socket.join(roomId)`.
*   **Isolation:** All message broadcasts, typing indicators (`"Someone is typing..."`), and deletion events are strictly routed using `io.to(roomId).emit()`. It is impossible for data packets to leak between different rooms.

### 4. Advanced Message Management (Soft Deletions)
Messages are never hard-deleted from the database, preventing data loss and preserving historical integrity.
*   **Delete for Me:** Hides the message from the user's personal timeline. 
    *   *Backend Flow:* Pushes the user's ID into the message's `deletedFor` array in MongoDB via an atomic `$addToSet` command.
    *   *Frontend Flow:* When fetching history, the controller dynamically queries: `$ne: req.session.userId`, perfectly stripping ignored messages.
*   **Delete for Everyone:** Retracts the message for all participants.
    *   *Security:* The backend verifies that the requester's ID exactly matches the original `message.sender`.
    *   *Backend Flow:* Toggles a `deletedForEveryone: true` Boolean on the message document.
    *   *Frontend Flow:* WebSockets instantly overwrite the text bubble in the DOM with an italicized *"This message was deleted"* placeholder and strips the UI dropdown controls.

### 5. Live "Online" Presence Tracking
*   **Global Map:** The server (`app.js`) maintains a global `Map()` correlating `userId` to active `socket.id`.
*   **UI Indicators:** Inside the Chat View, a "Members" sidebar dynamically loops through the room's roster.
*   **Real-time Sync:** When a user connects or disconnects (closes tab), global `user-status-changed` events are broadcast. The DOM catches these events and instantly toggles that specific user's status dot between **Green** (Online) and **Gray** (Offline).

### 6. 1-on-1 WebRTC Video Calling
*   **UI Integration:** The chat header features a sleek Dropdown Call Menu containing a real-time list of online/offline room members. 
*   **Signaling:** Clicking a member bypasses URL prompts and executes `startCall(targetUser)`. The server uses SocketTracker maps to accurately bounce Session Description Protocol (SDP) offers, answers, and ICE Candidates between the Caller and Callee.
*   **Connection:** Once the WebRTC handshake completes, users establish a direct, low-latency Peer-to-Peer visual and audio link without routing heavy video data through the Node server.

---

## 🏗️ Architectural Layout (MVC)

The project cleanly separates concerns into Models, Views, and Controllers:

*   **`/models`**: MongoDB Schemas defining data structure mapping.
    *   `User.js`: Schema for credentials and hashes.
    *   `Room.js`: Schema for tracking admins, approved members, and pending requests.
    *   `message.js`: Schema containing text, references to the `roomId`/`sender`, and soft-delete states (`deletedFor`, `deletedForEveryone`).
*   **`/controllers`**: The business logic determining *how* data is processed.
    *   `authController.js`: Handles hashing, session initialization, and duplicate-checks.
    *   `roomController.js`: Queries the database to serve Lobby arrays, process Join approvals, and fetch chat history respecting blacklist filters.
*   **`/routes`**: The API express definitions that bridge HTTP requests to Controller logic.
    *   `authRoutes.js`
    *   `roomRoutes.js`
*   **`/views`**: Frontend EJS templates injected with server-side variables. Contains dynamic JavaScript `socket.on` listeners and DOM manipulation functions.
*   **`/middleware/auth.js`**: Reusable gateway functions intercepting navigation to ensure the User possesses a valid session token and the correct Room Authorizations.
*   **`app.js`**: The central application hub. Mounts routes, connects to MongoDB, initializes session configurations, and listens for global WebSocket events.

---

## 🚀 How to Run Locally

1.  **Install Dependencies:** Navigate to the project root and run `npm install` (installs express, mongoose, socket.io, bcryptjs, etc).
2.  **Environment Variables:** Ensure your `.env` file contains:
    ```env
    MONGO_URI=your_mongodb_connection_string
    SESSION_SECRET=your_secure_random_string
    PORT=3003
    ```
3.  **Boot the Server:** Run `npm run start` or `node app.js`.
4.  **Access:** Open your browser and navigate to `http://localhost:3003`. 
5.  **Test the system:** Open an incognito window concurrently to simulate two different users interacting, requesting room joins, and sending messages/video calls!
