import type { Request, Response } from "express";
import axios from "axios";
import type { Product } from "../entities/Product.js";

export interface CloverInventoryResponse {
  elements: Product[];
  href: string;
}

export const getCloverInventory = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const token = process.env.CLOVER_SECRET?.replace(
      /[^\x20-\x7E]/g,
      "",
    ).trim();
    const merchantId = process.env.CLOVER_MERCHANT_ID?.trim();
    const baseUrl = process.env.CLOVER_BASE_URL?.trim();

    if (!token || !merchantId || !baseUrl) {
      console.error("Missing Clover ENV variables at runtime");
      res.status(500).json({
        success: false,
        message: "Server Configuration Error",
      });
      return;
    }

    const cloverClient = axios.create({
      baseURL: `${baseUrl.replace(/\/$/, "")}/${merchantId}`,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "Kwetu-Stores-Backend",
      },
    });

    const response = await cloverClient.get<CloverInventoryResponse>("/items", {
      params: {
        expand: "images,tags,categories",
        limit: 100,
      },
    });

    const items = response.data.elements || [];

    res.status(200).json({
      success: true,
      count: items.length,
      data: items,
    });
  } catch (error: any) {
    const errorData = error.response?.data;
    console.error("Clover API Error:", errorData || error.message);

    res.status(error.response?.status || 500).json({
      success: false,
      message: errorData?.message || "Error fetching from Clover",
      details: errorData || null,
    });
  }
};
