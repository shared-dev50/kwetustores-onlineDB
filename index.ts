import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import cloverRoutes from "./src/routes/cloverRoutes.js";

const app = express();
const port = process.env.PORT || 3000;

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json());

// --- ROUTES ---
app.use("/api/clover", cloverRoutes);

app.get("/", (req, res) => {
  res.send("Backend is running...");
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
