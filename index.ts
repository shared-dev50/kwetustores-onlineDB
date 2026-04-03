import dotenv from "dotenv";
dotenv.config();

import express, { type Request, type Response } from "express";
import cors from "cors";
import cloverRoutes from "./src/routes/cloverRoutes.js";

const app = express();
const port = process.env.PORT || 3000;

// --- CORS CONFIGURATION ---
const allowedOrigins = [
  "http://localhost:5173", 
  "https://kwetustores-online.vercel.app",
  "https://kwetustores.com"

];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.error(`CORS Blocked: Request from ${origin}`);
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);

// --- MIDDLEWARE ---
app.use(express.json());

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// --- ROUTES ---
app.use("/api/clover", cloverRoutes);

// Health Check / Root
app.get("/", (req: Request, res: Response) => {
  res.status(200).send({
    status: "Online",
    message: "Kwetu Stores Backend is running...",
    timestamp: new Date().toISOString()
  });
});

// --- ERROR HANDLING ---
app.use((err: any, req: Request, res: Response, next: any) => {
  console.error("Global Error:", err.stack);
  res.status(500).json({ error: "Internal Server Error" });
});

app.listen(port, () => {
  console.log(`🚀 Server is flying on port ${port}`);
  console.log(`Allowed Origins: ${allowedOrigins.join(", ")}`);
});