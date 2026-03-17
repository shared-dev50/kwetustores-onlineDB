import type { Request, Response } from "express";
import axios from "axios";
import type { CloverItem } from "../entities/clover.js";

export interface CloverInventoryResponse {
  elements: CloverItem[];
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

    const cleanBaseUrl = baseUrl.replace(/\/$/, "");
    const finalBaseUrl = `${cleanBaseUrl}/merchants/${merchantId}`;

    const cloverClient = axios.create({
      baseURL: finalBaseUrl,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "Kwetu-Stores-Backend",
      },
    });

    let allItems: CloverItem[] = [];
    let offset = 0;
    const limit = 100;
    let hasMore = true;

    while (hasMore) {
      const response = await cloverClient.get<CloverInventoryResponse>(
        "/items",
        {
          params: {
            expand: "images,tags,categories",
            limit: limit,
            offset: offset,
          },
        },
      );

      const elements = response.data.elements || [];

      if (elements.length > 0) {
        allItems = [...allItems, ...elements];
      }

      if (elements.length === limit) {
        offset += limit;
      } else {
        hasMore = false;
      }
    }

    const uniqueMap = new Map<string, CloverItem>();
    allItems.forEach(item => {
      if (item.id) {
        uniqueMap.set(item.id, item);
      }
    });

    const finalItems = Array.from(uniqueMap.values());

    res.status(200).json({
      success: true,
      count: finalItems.length,
      data: finalItems,
    });
  } catch (error: any) {
    const errorData = error.response?.data;
    const statusCode = error.response?.status || 500;

    console.error(
      `Clover API Error (${statusCode}):`,
      errorData || error.message,
    );

    if (error.config) {
      console.error(
        `Attempted URL: ${error.config.baseURL}${error.config.url}`,
      );
    }

    res.status(statusCode).json({
      success: false,
      message: errorData?.message || "Error fetching from Clover",
      details: errorData || null,
    });
  }
};

export const getSingleCloverItem = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const token = process.env.CLOVER_SECRET?.trim();
    const merchantId = process.env.CLOVER_MERCHANT_ID?.trim();
    const baseUrl = process.env.CLOVER_BASE_URL?.trim();

    const url = `${baseUrl}/merchants/${merchantId}/items/${id}`;

    const response = await axios.get(url, {
      params: { expand: "images,categories,tags" },
      headers: { Authorization: `Bearer ${token}` },
    });

    res.json({
      success: true,
      data: response.data,
    });
  } catch (error: any) {
    res.status(404).json({ success: false, message: "Item not found" });
  }
};
