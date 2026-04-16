import 'dotenv/config';
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

const getCloverConfig = () => {
 const token = process.env.CLOVER_SECRET?.replace(
      /[^\x20-\x7E]/g,
      "",
    ).trim();
  const merchantId = process.env.CLOVER_MERCHANT_ID?.trim();
  const baseUrl = process.env.CLOVER_BASE_URL?.trim();
  const ecommUrl = process.env.CLOVER_ECOMM_URL?.trim() || "https://checkout.clover.com";
  const frontendUrl = process.env.FRONTEND_URL?.trim();

  if (!token || !merchantId || !baseUrl) {
    throw new Error("Missing Clover ENV variables");
  }

  return {
    token,
    merchantId,
    baseUrl: baseUrl.replace(/\/$/, ""), 
    ecommUrl: ecommUrl.replace(/\/$/, ""),
    frontendUrl: frontendUrl ? frontendUrl.replace(/\/$/, "") : undefined,  
  };
};

const createCloverClient = () => {
  const { token, merchantId, baseUrl } = getCloverConfig();

  return axios.create({
    baseURL: `${baseUrl}/v3/merchants/${merchantId}`, 
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
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
    const { token, merchantId, frontendUrl,baseUrl } = getCloverConfig();
    const { items, customer, orderType, address, customerNote } = req.body;

    if (!token || !merchantId || !frontendUrl) {
      return res.status(500).json({ error: "Missing server configuration" });
    }

    const totalItemsCount = items.reduce(
      (acc: number, item: any) => acc + item.quantity,
      0
    );

const finalCloverNote = `
ORDER TYPE: ${orderType}
${orderType === "DELIVERY" ? `SHIP TO: ${address || "N/A"}` : "PICKUP AT STORE"}

CUSTOMER EMAIL: ${customer.email}
PHONE: ${customer.phoneNumber}
FULL NAME: ${customer.fullName || `${customer.firstName} ${customer.lastName}`}

${customerNote ? `CUSTOMER NOTE: ${customerNote}` : ""}`.trim();

    const lineItems = items.map((item: any, index: number) => ({
      itemRefUuid: item.id || item.product?.id,
      unitQty: item.quantity,
      ...(index === 0 ? { note: finalCloverNote } : {}),
    }));

    const shippingItemId = process.env.CLOVER_SHIPPING_ITEM_ID;

 if (orderType === "DELIVERY" && totalItemsCount > 0) {
      lineItems.push({
    itemRefUuid: shippingItemId,
        unitQty: totalItemsCount,
      });
    }
    const checkoutResponse = await axios.post(
      `${baseUrl}/invoicingcheckoutservice/v1/checkouts`,
      {
        customer: {
          email: customer.email,
          firstName: customer.firstName,
          lastName: customer.lastName,
          phoneNumber: customer.phoneNumber,
        },
        shoppingCart: { lineItems },


        metadata: {
          orderType,
          customerEmail: customer.email,
          customerPhone: customer.phoneNumber,
          customerName: `${customer.firstName} ${customer.lastName}`,
          address: address || "",
          customerNote: customerNote || "",
        },

        successUrl: `${frontendUrl}/success`,
        cancelUrl: `${frontendUrl}/cancel`,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Clover-Merchant-Id": merchantId,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      }
    );

    return res.json({
      success: true,
      checkoutUrl: checkoutResponse.data.href,
    });
  } catch (error: any) {
  console.error("Clover Checkout Failed");

  if (error.response) {
    console.error("Status:", error.response.status);
    console.error("Data:", JSON.stringify(error.response.data, null, 2));
  } else {
    console.error("Message:", error.message);
  }

  return res.status(500).json({ error: "Checkout failed" });
}
};

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.GOOGLE_PASS,
  },
  family: 4, 
  connectionTimeout: 30000, // 60 Seconds
  greetingTimeout: 30000,
  socketTimeout: 30000,
  debug: true,
  logger: true,
} as any);

export const handleCloverWebhook = async (req: Request, res: Response) => {
  const event = req.body;

  // 1. Clover Handshake
  if (event.verificationCode) {
    return res.status(200).send(event.verificationCode);
  }

  console.log("🚀 Clover Webhook received. Event ID:", event.id || event.objectId);

  try {
    const merchantId = process.env.CLOVER_MERCHANT_ID?.trim();
    const token = process.env.CLOVER_SECRET?.replace(/[^\x20-\x7E]/g, "").trim();
    const paymentId = event.objectId || event.id;

    if (!paymentId || event.type === "PING") {
      return res.status(200).send("OK");
    }

    // 2. Fetch Order Data 
    const paymentResponse = await axios.get(
      `${process.env.CLOVER_ECOMM_URL}/merchants/${merchantId}/payments/${paymentId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const paymentData = paymentResponse.data;
    const orderId = paymentData.order?.id || paymentData.orderRef?.id;

    if (!orderId) return res.status(200).send("NO_ORDER_ID");

    const orderResponse = await axios.get(
      `${process.env.CLOVER_ECOMM_URL}/v3/merchants/${merchantId}/orders/${orderId}?expand=lineItems,customers`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const orderData = orderResponse.data;

    const rawNotes = [
      orderData.note,
      paymentData.note,
      ...(orderData.lineItems?.elements?.map((li: any) => li.note) || []),
    ];
    const uniqueNotes = [...new Set(rawNotes.filter((n) => n && typeof n === "string"))];
    let orderNote = uniqueNotes.find((n) => n.includes("ORDER TYPE")) || uniqueNotes[0] || "";

    const emailMatch = orderNote.match(/^CUSTOMER EMAIL:\s*(.+)$/im);
    const phoneMatch = orderNote.match(/^PHONE:\s*(.+)$/im);
    const nameMatch = orderNote.match(/^FULL NAME:\s*(.+)$/im);
    const orderTypeMatch = orderNote.match(/^ORDER TYPE:\s*(.+)$/im);

    const buyerEmail = emailMatch?.[1]?.trim() || null;
    const buyerPhone = phoneMatch?.[1]?.trim() || "N/A";
    const buyerName = nameMatch?.[1]?.trim() || "Customer";
    const orderType = orderTypeMatch?.[1]?.trim()?.toUpperCase() || "UNKNOWN";
    const totalAmount = (orderData.total || 0) / 100;


    console.log("📨 BLOCKER 1: Sending Merchant Notification...");
    const merchantRes = await transporter.sendMail({
      from: `"Kwetu Stores System" <${process.env.EMAIL_USER}>`,
      to: process.env.MERCHANT_NOTIFICATION_EMAIL,
      subject: `🚨 NEW ORDER - ${orderType} - USD ${totalAmount}`,
 html: `
  <div style="font-family: Arial, sans-serif; background: #f6f7fb; padding: 24px; color: #111827;">
    <div style="max-width: 640px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e5e7eb;">
      
      <div style="background: #ea580c; color: white; padding: 20px 24px;">
        <h1 style="margin: 0; font-size: 22px;">🛒 New Order Received</h1>
        <p style="margin: 8px 0 0; font-size: 14px; opacity: 0.95;">
          A new ${orderType.toLowerCase()} order has been placed.
        </p>
      </div>

      <div style="padding: 24px;">
        <div style="margin-bottom: 24px;">
          <h2 style="font-size: 16px; margin: 0 0 12px; color: #111827;">Order Summary</h2>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr>
              <td style="padding: 10px 0; color: #6b7280;">Order ID</td>
              <td style="padding: 10px 0; font-weight: 600; text-align: right;">${orderId}</td>
            </tr>
            <tr style="border-top: 1px solid #f1f5f9;">
              <td style="padding: 10px 0; color: #6b7280;">Order Type</td>
              <td style="padding: 10px 0; font-weight: 600; text-align: right;">${orderType}</td>
            </tr>
            <tr style="border-top: 1px solid #f1f5f9;">
              <td style="padding: 10px 0; color: #6b7280;">Total</td>
              <td style="padding: 10px 0; font-weight: 700; text-align: right; color: #ea580c;">USD ${totalAmount.toFixed(2)}</td>
            </tr>
          </table>
        </div>

        <div style="margin-bottom: 24px;">
          <h2 style="font-size: 16px; margin: 0 0 12px; color: #111827;">Customer Details</h2>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr>
              <td style="padding: 10px 0; color: #6b7280;">Full Name</td>
              <td style="padding: 10px 0; font-weight: 600; text-align: right;">${buyerName}</td>
            </tr>
            <tr style="border-top: 1px solid #f1f5f9;">
              <td style="padding: 10px 0; color: #6b7280;">Email</td>
              <td style="padding: 10px 0; font-weight: 600; text-align: right;">${buyerEmail || "N/A"}</td>
            </tr>
            <tr style="border-top: 1px solid #f1f5f9;">
              <td style="padding: 10px 0; color: #6b7280;">Phone</td>
              <td style="padding: 10px 0; font-weight: 600; text-align: right;">${buyerPhone}</td>
            </tr>
          </table>
        </div>

        <div style="margin-bottom: 24px;">
          <h2 style="font-size: 16px; margin: 0 0 12px; color: #111827;">Order Note</h2>
          <div style="background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; white-space: pre-wrap; font-size: 13px; line-height: 1.6; color: #334155;">
${orderNote}
          </div>
        </div>

        <p style="font-size: 12px; color: #9ca3af; margin-top: 24px;">
          This email was automatically generated by Kwetu Stores.
        </p>
      </div>
    </div>
  </div>
`,
    });
    console.log("✅ Merchant Email Status: ACCEPTED", merchantRes.messageId);

    // SEND BUYER EMAIL & AWAIT
    if (buyerEmail && buyerEmail !== "Unknown") {
      console.log("📨 BLOCKER 2: Sending Buyer Receipt...");
      const buyerRes = await transporter.sendMail({
        from: `"Kwetu Stores" <${process.env.EMAIL_USER}>`,
        to: buyerEmail,
        subject: `Order Confirmation - Kwetu Stores`,
html: `
  <div style="font-family: Arial, sans-serif; background: #f6f7fb; padding: 24px; color: #111827;">
    <div style="max-width: 640px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e5e7eb;">
      
      <div style="background: #ea580c; color: white; padding: 20px 24px;">
        <h1 style="margin: 0; font-size: 22px;">🛒 New Order Received</h1>
        <p style="margin: 8px 0 0; font-size: 14px; opacity: 0.95;">
          A new ${orderType.toLowerCase()} order has been placed.
        </p>
      </div>

      <div style="padding: 24px;">
        <div style="margin-bottom: 24px;">
          <h2 style="font-size: 16px; margin: 0 0 12px; color: #111827;">Order Summary</h2>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr>
              <td style="padding: 10px 0; color: #6b7280;">Order ID</td>
              <td style="padding: 10px 0; font-weight: 600; text-align: right;">${orderId}</td>
            </tr>
            <tr style="border-top: 1px solid #f1f5f9;">
              <td style="padding: 10px 0; color: #6b7280;">Order Type</td>
              <td style="padding: 10px 0; font-weight: 600; text-align: right;">${orderType}</td>
            </tr>
            <tr style="border-top: 1px solid #f1f5f9;">
              <td style="padding: 10px 0; color: #6b7280;">Total</td>
              <td style="padding: 10px 0; font-weight: 700; text-align: right; color: #ea580c;">USD ${totalAmount.toFixed(2)}</td>
            </tr>
          </table>
        </div>

        <div style="margin-bottom: 24px;">
          <h2 style="font-size: 16px; margin: 0 0 12px; color: #111827;">Customer Details</h2>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr>
              <td style="padding: 10px 0; color: #6b7280;">Full Name</td>
              <td style="padding: 10px 0; font-weight: 600; text-align: right;">${buyerName}</td>
            </tr>
            <tr style="border-top: 1px solid #f1f5f9;">
              <td style="padding: 10px 0; color: #6b7280;">Email</td>
              <td style="padding: 10px 0; font-weight: 600; text-align: right;">${buyerEmail || "N/A"}</td>
            </tr>
            <tr style="border-top: 1px solid #f1f5f9;">
              <td style="padding: 10px 0; color: #6b7280;">Phone</td>
              <td style="padding: 10px 0; font-weight: 600; text-align: right;">${buyerPhone}</td>
            </tr>
          </table>
        </div>

        <div style="margin-bottom: 24px;">
          <h2 style="font-size: 16px; margin: 0 0 12px; color: #111827;">Order Note</h2>
          <div style="background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; white-space: pre-wrap; font-size: 13px; line-height: 1.6; color: #334155;">
${orderNote}
          </div>
        </div>

        <p style="font-size: 12px; color: #9ca3af; margin-top: 24px;">
          This email was automatically generated by Kwetu Stores.
        </p>
      </div>
    </div>
  </div>
`,
      });
      console.log("✅ Buyer Email Status: ACCEPTED", buyerRes.messageId);
    }

    return res.status(200).send("SUCCESS");

  } catch (err: any) {
   console.error("❌ Webhook Processing Failed:");
console.error("Message:", err.message);
console.error("Stack:", err.stack);
console.error("Response Data:", err.response?.data);
console.error("Response Status:", err.response?.status);
console.error("Full Error:", err);
    return res.status(200).send("ERROR_LOGGED");
  }
};