import express from "express";
import {
  getCloverInventory,
  getSingleCloverItem,
} from "../controllers/cloverController.js";

const router = express.Router();

router.get("/inventory", getCloverInventory);
router.get("/inventory/:id", getSingleCloverItem);

export default router;
