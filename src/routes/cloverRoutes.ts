import express from "express";
import { getCloverInventory } from "../controllers/cloverController.js";

const router = express.Router();

router.get("/inventory", getCloverInventory);

export default router;
