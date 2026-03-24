import type { Request, Response } from "express";
import nodemailer from "nodemailer";
import axios from "axios";
import type { CloverItem } from "../entities/clover.js";

export interface CloverInventoryResponse {
  elements: CloverItem[];
  href: string;
}

interface CloverStockElement {
  item?: { id?: string };
  quantity?: number;
}

interface CloverStockResponse {
  elements: CloverStockElement[];
}
// Nodemailer transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const getCloverConfig = () => {
  const token = process.env.CLOVER_SECRET?.replace(/[^\x20-\x7E]/g, "").trim();
  const merchantId = process.env.CLOVER_MERCHANT_ID?.trim();
  const baseUrl = process.env.CLOVER_BASE_URL?.trim();

  if (!token || !merchantId || !baseUrl) {
    throw new Error("Missing Clover ENV variables");
  }

  return {
    token,
    merchantId,
    baseUrl: baseUrl.replace(/\/$/, ""),
  };
};

const createCloverClient = () => {
  const { token, merchantId, baseUrl } = getCloverConfig();

  return axios.create({
    baseURL: `${baseUrl}/merchants/${merchantId}`,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "Kwetu-Stores-Backend",
    },
  });
};

export const getCloverInventory = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const cloverClient = createCloverClient();

    const stockMap = new Map<string, number>();
    let stockOffset = 0;
    const stockLimit = 100;
    let hasMoreStock = true;

    while (hasMoreStock) {
      const stockResponse = await cloverClient.get<CloverStockResponse>(
        "/item_stocks",
        {
          params: { limit: stockLimit, offset: stockOffset },
        },
      );

      const stockElements = stockResponse.data.elements || [];

      stockElements.forEach(stock => {
        const itemId = stock.item?.id;
        if (itemId) {
          stockMap.set(itemId, stock.quantity ?? 0);
        }
      });

      hasMoreStock = stockElements.length === stockLimit;
      if (hasMoreStock) stockOffset += stockLimit;
    }

    let allItems: CloverItem[] = [];
    let itemOffset = 0;
    const itemLimit = 100;
    let hasMoreItems = true;

    while (hasMoreItems) {
      const response = await cloverClient.get<CloverInventoryResponse>(
        "/items",
        {
          params: {
            expand: "images,tags,categories",
            limit: itemLimit,
            offset: itemOffset,
          },
        },
      );

      const elements = response.data.elements || [];
      allItems.push(...elements);

      hasMoreItems = elements.length === itemLimit;
      if (hasMoreItems) itemOffset += itemLimit;
    }

    const finalItems = allItems.map(item => ({
      ...item,
      price: item.price != null ? Number((item.price / 100).toFixed(2)) : 0.0,
      stockQuantity: item.id ? (stockMap.get(item.id) ?? 0) : 0,
    }));

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

    res.status(statusCode).json({
      success: false,
      message:
        errorData?.message || error.message || "Error fetching from Clover",
      details: errorData || null,
    });
  }
};

export const getSingleCloverItem = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const cloverClient = createCloverClient();

    const [itemResponse, stockResponse] = await Promise.all([
      cloverClient.get(`/items/${id}`, {
        params: { expand: "images,categories,tags" },
      }),
      cloverClient.get(`/item_stocks/${id}`),
    ]);

    const item = itemResponse.data;
    const stockQuantity = stockResponse.data?.quantity ?? 0;

    const processedItem = {
      ...item,
      price: item.price != null ? Number((item.price / 100).toFixed(2)) : 0.0,
      stockQuantity,
    };
    res.status(200).json({
      success: true,
      data: processedItem,
    });
  } catch (error: any) {
    const errorData = error.response?.data;
    const statusCode = error.response?.status || 500;

    console.error(
      `Clover API Error (${statusCode}):`,
      errorData || error.message,
    );

    res.status(statusCode).json({
      success: false,
      message: errorData?.message || "Error fetching item from Clover",
      details: errorData || null,
    });
  }
};

export const getCloverCategories = async (req: Request, res: Response) => {
  try {
    const cloverClient = createCloverClient();
    let allCategories: any[] = [];
    let offset = 0;
    const limit = 100;
    let hasMore = true;

    while (hasMore) {
      const response = await cloverClient.get("/categories", {
        params: {
          limit: limit,
          offset: offset,
        },
      });

      const elements = response.data.elements || [];
      allCategories = [...allCategories, ...elements];

      if (elements.length === limit) {
        offset += limit;
      } else {
        hasMore = false;
      }
    }

    res.status(200).json({
      success: true,
      count: allCategories.length,
      data: allCategories,
    });
  } catch (error: any) {
    console.error("Clover Categories Error:", error.message);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch categories" });
  }
};

export const createCheckout = async (req: Request, res: Response) => {
  try {
    const token = process.env.CLOVER_SECRET?.replace(
      /[^\x20-\x7E]/g,
      "",
    ).trim();
    const merchantId = process.env.CLOVER_MERCHANT_ID?.trim();
    const frontendUrl = process.env.FRONTEND_URL?.trim();

    const { items, customer, orderType, address } = req.body;

    if (!token || !merchantId || !frontendUrl) {
      return res.status(500).json({ error: "Missing server configuration" });
    }

    const totalItemsCount = items.reduce(
      (acc: number, item: any) => acc + item.quantity,
      0,
    );

    const lineItems = items.map((item: any) => ({
      name: item.product.name,
      unitQty: item.quantity,
      price: Math.round(item.product.price * 100),
    }));

    let shippingAmount = 0;
    if (
      orderType === "DELIVERY" &&
      totalItemsCount > 0 &&
      totalItemsCount < 4
    ) {
      shippingAmount = totalItemsCount * 7;
      lineItems.push({
        id: "P79B9AXNV6BP4",
        name: "Shipping Fee",
        unitQty: totalItemsCount,
        price: 700,
        note: "Per-item shipping rate",
      });
    }
    const finalCloverNote = `
${address} 
---
ITEMS:
${items.map((i: any) => `- ${i.quantity}x ${i.product.name}`).join("\n")}
`.trim();
    const checkoutResponse = await axios.post(
      "https://api.clover.com/invoicingcheckoutservice/v1/checkouts",
      {
        customer: {
          email: customer.email,
          firstName: customer.firstName,
          lastName: customer.lastName,
          phoneNumber: customer.phoneNumber,
        },
        shoppingCart: {
          lineItems: lineItems,
        },
        note: finalCloverNote,
        successUrl: `${frontendUrl}/success`,
        cancelUrl: `${frontendUrl}/cart`,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Clover-Merchant-Id": merchantId,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      },
    );

    return res.json({
      success: true,
      checkoutUrl: checkoutResponse.data.href,
    });
  } catch (error: any) {
    console.error("Clover API Error:", error.response?.data || error.message);
    return res.status(error.response?.status || 500).json({
      error: "Could not initialize Clover payment",
      details: error.response?.data || null,
    });
  }
};

export const handleCloverWebhook = async (req: Request, res: Response) => {
  const event = req.body;

  res.status(200).send("EVENT_RECEIVED");

  if (event.type === "PAYMENT_SUCCESS") {
    const { orderId } = event.data;

    try {
      // 1. Fetch order from Clover
      const cloverOrder = await axios.get(
        `https://api.clover.com/v3/merchants/${process.env.CLOVER_MERCHANT_ID}/orders/${orderId}?expand=customers`,
        {
          headers: {
            Authorization: `Bearer ${process.env.CLOVER_SECRET?.replace(/[^\x20-\x7E]/g, "").trim()}`,
          },
        },
      );

      const orderNote = cloverOrder.data.note;
      const customerEmail =
        cloverOrder.data.customers?.elements?.[0]?.emailAddresses?.elements?.[0]
          ?.email;

      // 2. NOTIFY MERCHANT
      await transporter.sendMail({
        from: `"Kwetu Order System" <${process.env.EMAIL_USER}>`,
        to: process.env.MERCHANT_NOTIFICATION_EMAIL,
        subject: `🚨 NEW ORDER - ${orderId}`,
        html: `
          <h2 style="color: #ea580c;">New Sale Confirmed!</h2>
          <p>Pack this order immediately. Details below:</p>
          <div style="background: #f4f4f4; padding: 15px; border-radius: 10px;">
            <pre style="font-family: sans-serif; white-space: pre-wrap;">${orderNote}</pre>
          </div>
        `,
      });

      // 3. NOTIFY BUYER
      if (customerEmail) {
        await transporter.sendMail({
          from: `"Kwetu Stores" <${process.env.EMAIL_USER}>`,
          to: customerEmail,
          subject: `Thank you for your order!`,
          html: `
            <h2>Order Confirmation</h2>
            <p>We've received your payment. Here are your order details:</p>
            <div style="border: 1px solid #eee; padding: 15px;">
              <pre style="font-family: sans-serif; white-space: pre-wrap;">${orderNote}</pre>
            </div>
            <p>If you have any questions, please contact us!</p>
          `,
        });
      }

      console.log(`Success: Notifications sent for Order ${orderId}`);
    } catch (err) {
      console.error("Webhook Processing Error:", err);
    }
  }
};
