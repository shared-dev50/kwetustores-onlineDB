import express from "express";
import {
  createCheckout,
  getCloverCategories,
  getCloverInventory,
  getSingleCloverItem,
  handleCloverWebhook
} from "../controllers/cloverController.js";

const router = express.Router();

router.get("/inventory", getCloverInventory);
router.get("/inventory/:id", getSingleCloverItem);
router.get("/categories", getCloverCategories);
router.post("/create-checkout", createCheckout);
router.post("/webhook", handleCloverWebhook);

export default router;
