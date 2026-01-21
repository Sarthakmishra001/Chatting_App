## EchoChat – Real‑Time Chat App

EchoChat is a simple real‑time chat application built with **Node.js**, **Express**, **Socket.IO**, **EJS**, and **MongoDB**.  
It supports a lightweight signup with a shared password, persistent messages, typing indicators, and light/dark UI modes.

### Live Demo

- **Deployed on Render**: `https://echochat-app-upsw.onrender.com`  
  - Replace the URL above with your actual deployed link.

### Features

- **Real‑time messaging**: Messages are delivered instantly using `socket.io`.
- **Persistent chat history**: Messages are stored in MongoDB via a `Message` model.
- **Simple protected signup**:
  - Users enter a **username**.
  - Access is gated by a **fixed password** stored in an environment variable.
- **Session‑based auth**:
  - After successful signup, the username is stored in an Express session.
  - Unauthenticated users are redirected back to the signup page.
- **Typing indicator**: Shows when someone is typing in the chat.
- **Light/Dark themes**:
  - Dark/light toggle on the chat screen.
  - Light/dark mode switch on the signup screen.
- **Message actions (UI)**:
  - Hover to show delete icon and a small menu with:
    - *Delete for Me*
    - *Delete for Everyone*
    - *Cancel*

### Tech Stack

- **Backend**: Node.js, Express, Socket.IO
- **View Engine**: EJS
- **Database**: MongoDB with Mongoose
- **Auth / State**: express‑session
- **Styling**: Tailwind CSS CDN, custom CSS

### Project Structure

- `app.js` – Main Express app, Socket.IO setup, routes, and session handling.
- `models/mongodb.js` – MongoDB connection using Mongoose.
- `models/message.js` – Mongoose schema/model for chat messages.
- `views/signup.ejs` – Signup page (username + fixed password) with light/dark mode.
- `views/chat.ejs` – Chat UI with message list, theme toggle, typing indicator, and delete UI.

### Environment Variables

Create a `.env` file in the project root and define:

```bash
PORT=3001                 # Optional locally; Render will set this automatically
MONGO_URI=<your-mongodb-connection-string>
FIXED_PASSWORD=<shared-chat-password>
SESSION_SECRET=<any-random-secret-string>
```

- **`MONGO_URI`**: Your MongoDB/Atlas connection string.
- **`FIXED_PASSWORD`**: The password required on the signup page.
- **`SESSION_SECRET`**: Secret key for signing Express sessions.
- **`PORT`**: Port for the HTTP server; Render injects this environment variable automatically.

### Installation & Local Development

1. **Clone the repository**

```bash
git clone <repo-url>
cd echoChat\ app
```

2. **Install dependencies**

```bash
npm install
```

3. **Set up environment variables**

- Create a `.env` file (see **Environment Variables** section above).

4. **Run the app**

- Development (with nodemon, if installed globally):

```bash
npm run dev
```

- Or standard start:

```bash
npm start
```

5. **Open in browser**

- Visit `http://localhost:3001` (or the port you configured).
- You will be redirected to `/signup`.
- Enter a **username** and the shared **password** (`FIXED_PASSWORD`).
- On success you are redirected to `/chat?user=<username>`.

### How It Works

- **Startup**
  - `app.js` loads environment variables, connects to MongoDB, and starts an HTTP server on `process.env.PORT || 3001`.
  - Socket.IO is attached to the same HTTP server.

- **Signup Flow**
  - `GET /` redirects to `/signup`.
  - `GET /signup` renders `signup.ejs`.
  - `POST /signup`:
    - Checks `password` against `FIXED_PASSWORD`.
    - On success:
      - Stores `username` on `req.session.user`.
      - Redirects to `/chat?user=<username>`.
    - On failure:
      - Renders `signup.ejs` with an error message.

- **Chat Page**
  - `GET /chat`:
    - Redirects to `/signup` if there is no `req.session.user`.
    - Fetches all messages from MongoDB (`Message.find().sort({ timestamp: 1 })`).
    - Renders `chat.ejs` with `messages` and `username`.

- **Real‑Time Messaging (Socket.IO)**
  - On `connection`, the server listens for:
    - `newMessage`: creates and saves a new `Message` document and broadcasts `messageBroadcast` to all clients.
    - `typing`: broadcasts `displayTyping` so other clients can show “user is typing…”.
    - `deleteForMe` & `deleteForEveryone`: server‑side handlers exist and emit corresponding events for clients that implement them.

### Deployment on Render

This app is compatible with **Render Web Services**.

- **Build Command**: *(leave empty / none – this is a Node app without a build step)*  
- **Start Command**:

```bash
npm start
```

- **Environment**:
  - Render automatically sets the `PORT` environment variable.
  - Make sure to define:
    - `MONGO_URI`
    - `FIXED_PASSWORD`
    - `SESSION_SECRET`

According to Render’s port binding rules (`https://render.com/docs/web-services#port-binding`):

- The app **must** listen on `process.env.PORT`.
- In `app.js` this is already handled with:
  - `const PORT = process.env.PORT || 3001;`
  - `server.listen(PORT, ...)`

Once deployed, use your Render service URL (e.g. `https://<your-app>.onrender.com`) as the **Live Demo** link in this README.

### License

This project is licensed under the **ISC License** (see `package.json`).

