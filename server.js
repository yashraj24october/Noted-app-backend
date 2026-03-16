const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs");
dotenv.config();

const app = express();
// const IS_PROD = process.env.NODE_ENV === 'production';

// ─── Core middleware ──────────────────────────────────
app.use(cors({
  origin: [
    "https://noted-pro.netlify.app","http://localhost:3000", "http://127.0.0.1:3000"
  ],
  credentials: true
}));

// if (IS_PROD) {
//   const frontendDist = path.join(__dirname, '../frontend/dist');

//    Only try to serve if the folder actually exists
//   if (fs.existsSync(frontendDist)) {
//     app.use(express.static(frontendDist));
//     app.get('*', (_req, res) => {
//       res.sendFile(path.join(frontendDist, 'index.html'));
//     });
//   } else {
//      Fallback so the root URL doesn't crash the server
//     app.get('/', (req, res) => {
//       res.json({ message: "Backend is live. Frontend build not found." });
//     });
//   }
// }

app.use(express.json({limit: "10mb"}));
app.use(express.urlencoded({extended: true, limit: "10mb"}));
app.use(cookieParser());

// ─── API Routes ──────────────────────────────────────
app.use("/api/auth", require("./routes/auth"));
app.use("/api/notes", require("./routes/notes"));
app.use("/api/tags", require("./routes/tags"));
app.use("/api/users", require("./routes/users"));
app.use("/api/shared", require("./routes/shared"));
app.use("/api/notebooks", require("./routes/notebooks"));
app.use("/api/images", require("./routes/images"));

// ─── Health check ────────────────────────────────────
app.get("/", (req, res) => {
  res.status(200).send(`
        <body style="margin:0; font-family: 'Inter', sans-serif; background: #f8f5f2; display:flex; align-items:center; justify-content:center; height:100vh;">
            <div style="background:white; padding: 2rem 3rem; border-radius: 24px; box-shadow: 0 20px 40px rgba(0,0,0,0.04); text-align:center;">
                <h1 style="color:#5d5fef; margin:0;">Welcome to the Noted App Backend</h1>
                <p style="color:#666; margin-top:0.5rem;">API Gateway is Online</p>
                <div style="margin-top:1.5rem; font-size:0.8rem; color:#aaa; border-top: 1px solid #eee; padding-top:1rem;">
                    #ProudlyIndian • v1.0.0 • Built with ❤️ by Yash Raj
                </div>
            </div>
        </body>
    `);
});

// API Metadata Route
app.get("/api", (req, res) => {
  res.json({
    app: "Noted", description: "Secure Note Taking API", documentation: "/api/docs", // If you use Swagger/Redoc
    status: "active"
  });
});

// System Health Route
app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "UP",
    uptime: `${Math.floor(process.uptime())}s`,
    timestamp: new Date().toISOString()
  });
});

// ─── Serve React frontend in production ──────────────
// Express serves the Vite build — no separate web server needed
// if (IS_PROD) {
//   const frontendDist = path.join(__dirname, '../frontend/dist');
//   app.use(express.static(frontendDist));

//    All non-API routes go to React (client-side routing)
//   app.get('*', (_req, res) => {
//     res.sendFile(path.join(frontendDist, 'index.html'));
//   });
// }

// ─── Global error handler ────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    success: false,
    message: IS_PROD
      ? "Internal Server Error"
      : err.message
  });
});

// ─── Connect DB and start server ─────────────────────
const PORT = process.env.PORT || 5000;

mongoose.connect(process.env.MONGO_URI).then(() => {
  console.log("✅  MongoDB connected");
  app.listen(PORT, () => {
    console.log(`🚀  Server on port ${PORT}  [${process.env.NODE_ENV}]`);
  });
}).catch(err => {
  console.error("❌  MongoDB connection error:", err);
  process.exit(1);
});

// let isConnected = false;

// async function connectToMongodDB() {
//   try {
//     await mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
//     console.log('✅  MongoDB connected');
//     isConnected = true;
//   }
//   catch (err) {
//     console.error('❌  MongoDB connection error:', err);
//   }
// }
// app.use(async (req, res, next) => {
//   if (!isConnected) {
//     await connectToMongodDB();
//   }
//   next();
// });

module.exports = app;