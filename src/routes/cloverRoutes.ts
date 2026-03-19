import express from "express";
import {
  getCloverCategories,
  getCloverInventory,
  getSingleCloverItem,
} from "../controllers/cloverController.js";

const router = express.Router();

router.get("/inventory", getCloverInventory);
router.get("/inventory/:id", getSingleCloverItem);
router.get("/categories", getCloverCategories);

export default router;
