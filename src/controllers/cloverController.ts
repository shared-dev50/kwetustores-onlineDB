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


// const getCloverConfig = () => {
//   const token = process.env.CLOVER_SECRET?.replace(/[^\x20-\x7E]/g, "").trim();
//   const merchantId = process.env.CLOVER_MERCHANT_ID?.trim();
//   const baseUrl = process.env.CLOVER_BASE_URL?.trim();

//   if (!token || !merchantId || !baseUrl) {
//     throw new Error("Missing Clover ENV variables");
//   }

//   return {
//     token,
//     merchantId,
//     baseUrl: baseUrl.replace(/\/$/, ""),
//   };
// };

const getCloverConfig = () => {
  const token = process.env.CLOVER_SECRET?.replace(/[^\x20-\x7E]/g, "").trim();
  const merchantId = process.env.CLOVER_MERCHANT_ID?.trim();
  const baseUrl = process.env.CLOVER_BASE_URL?.trim();
  const ecommUrl = process.env.CLOVER_ECOMM_URL?.trim() || "https://scl-sandbox.dev.clover.com";
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

// const createCloverClient = () => {
//   const { token, merchantId, baseUrl } = getCloverConfig();

//   return axios.create({
//     baseURL: `${baseUrl}/merchants/${merchantId}`,
//     headers: {
//       Authorization: `Bearer ${token}`,
//       Accept: "application/json",
//       "Content-Type": "application/json",
//       "User-Agent": "Kwetu-Stores-Backend",
//     },
//   });
// };

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
    const { token, merchantId, frontendUrl } = getCloverConfig();
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

${customerNote ? `CUSTOMER NOTE: ${customerNote}` : ""}

---
ITEMS:
${items.map((i: any) => `- ${i.quantity}x ${i.product.name}`).join("\n")}
`.trim();

    console.log("📝 Sending Clover Note:\n", finalCloverNote);

    const lineItems = items.map((item: any, index: number) => ({
      name: item.product.name,
      unitQty: item.quantity,
      price: Math.round(item.product.price * 100),

      // Attach the note ONLY to the first real item as fallback
      ...(index === 0 ? { note: finalCloverNote } : {}),
    }));

    // Optional shipping line
    if (orderType === "DELIVERY" && totalItemsCount > 0) {
      lineItems.push({
        id: "71CZGC2X5GRT2",
        name: "Shipping Fee",
        unitQty: totalItemsCount,
        price: 700,
        note: finalCloverNote, // <-- same note here too
      });
    }

    const checkoutResponse = await axios.post(
      "https://apisandbox.dev.clover.com/invoicingcheckoutservice/v1/checkouts",
      {
        customer: {
          email: customer.email,
          firstName: customer.firstName,
          lastName: customer.lastName,
          phoneNumber: customer.phoneNumber,
        },
        shoppingCart: { lineItems },

        // keep this too, but don't depend on it
        note: finalCloverNote,

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
    console.error(
      "Checkout Error Details:",
      error.response?.data || error.message
    );
    res.status(500).json({ error: "Checkout failed" });
  }
};

export const handleCloverWebhook = async (req: Request, res: Response) => {
  const event = req.body;

  // 1. Clover Handshake
  if (event.verificationCode) {
    return res.status(200).send(event.verificationCode);
  }

  console.log("🚀 Clover Webhook received. Event ID:", event.id || event.objectId);

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.GOOGLE_PASS,
    },
    family: 4,
    debug: true,
    logger: true,
  } as any);

  try {
    const merchantId = process.env.CLOVER_MERCHANT_ID;
    const token = process.env.CLOVER_SECRET;
    const paymentId = event.objectId || event.id;

    if (!paymentId || event.type === "PING") {
      return res.status(200).send("OK");
    }

    // 3. Fetch Payment Details
    const paymentResponse = await axios.get(
      `https://apisandbox.dev.clover.com/v3/merchants/${merchantId}/payments/${paymentId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const paymentData = paymentResponse.data;
    const orderId = paymentData.order?.id || paymentData.orderRef?.id;

    if (!orderId) {
      console.error("❌ No orderId found on payment");
      return res.status(200).send("NO_ORDER_ID");
    }

    // 4. Fetch Full Order
    const orderResponse = await axios.get(
      `https://apisandbox.dev.clover.com/v3/merchants/${merchantId}/orders/${orderId}?expand=lineItems,customers`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const orderData = orderResponse.data;

    console.log("🧾 FULL ORDER DATA:", JSON.stringify(orderData, null, 2));
    console.log("💳 FULL PAYMENT DATA:", JSON.stringify(paymentData, null, 2));

    // 5. Gather all possible notes
 const rawNotes = [
  orderData.note,
  paymentData.note,
  event.note,
  ...(orderData.lineItems?.elements?.map((li: any) => li.note) || []),
];

console.log("🧾 RAW NOTES:", rawNotes);

const uniqueNotes = [
  ...new Set(
    rawNotes
      .filter((n) => n && typeof n === "string" && n.trim() !== "")
      .map((n) => n.trim())
  ),
];

console.log("🧾 UNIQUE NOTES:", uniqueNotes);

// Prefer the note that contains customer info
let orderNote =
  uniqueNotes.find((n) => n.includes("ORDER TYPE")) ||
  uniqueNotes.find((n) => n.includes("CUSTOMER EMAIL")) ||
  uniqueNotes[0] ||
  "";

console.log("🧾 FINAL orderNote:", orderNote);

// Parse EXACT labels from your actual stored note
const emailMatch = orderNote.match(/^CUSTOMER EMAIL:\s*(.+)$/im);
const phoneMatch = orderNote.match(/^PHONE:\s*(.+)$/im);
const nameMatch = orderNote.match(/^FULL NAME:\s*(.+)$/im);
const addressMatch = orderNote.match(/^SHIP TO:\s*(.+)$/im);
const orderTypeMatch = orderNote.match(/^ORDER TYPE:\s*(.+)$/im);
const customerNoteMatch = orderNote.match(/^CUSTOMER NOTE:\s*(.+)$/im);

const cloverCust = orderData.customers?.elements?.[0];

const buyerEmail =
  emailMatch?.[1]?.trim() ||
  paymentData.receipt_email ||
  cloverCust?.emailAddresses?.[0]?.email ||
  null;

const buyerPhone =
  phoneMatch?.[1]?.trim() ||
  cloverCust?.phoneNumbers?.[0]?.phoneNumber ||
  "N/A";

const buyerName =
  nameMatch?.[1]?.trim() ||
  `${cloverCust?.firstName || ""} ${cloverCust?.lastName || ""}`.trim() ||
  "Customer";

const deliveryAddress = addressMatch?.[1]?.trim() || "N/A";
const orderType = orderTypeMatch?.[1]?.trim()?.toUpperCase() || "UNKNOWN";
const customerNoteText = customerNoteMatch?.[1]?.trim() || "None";

  if (!orderNote) {
  orderNote = "No customer notes found.";
}

    const totalAmount = (orderData.total || 0) / 100;

    console.log("📝 Final Note Used:", orderNote);
    console.log("✅ Parsed Data:", {
      buyerEmail,
      buyerPhone,
      buyerName,
      deliveryAddress,
      orderType,
    });

    // 7. Send Merchant Notification
const merchantRes = await transporter.sendMail({
  from: `"Kwetu Stores System" <${process.env.EMAIL_USER}>`,
  to: process.env.MERCHANT_NOTIFICATION_EMAIL,
  subject: `🚨 NEW ORDER - USD ${totalAmount} (${orderId})`,
  html: `
    <div style="font-family: sans-serif; border: 1px solid #eee; padding: 20px;">
      <h2 style="color: #2e7d32;">New Payment Received!</h2>
      <p><b>Customer:</b> ${buyerName}</p>
      <p><b>Email:</b> ${buyerEmail || "Unknown"}</p>
      <p><b>Phone:</b> ${buyerPhone}</p>
      <p><b>Order Type:</b> ${orderType}</p>
      ${
        orderType === "DELIVERY"
          ? `<p><b>Address:</b> ${deliveryAddress}</p>`
          : `<p><b>Pickup:</b> Customer will collect in store</p>`
      }
      <p><b>Customer Note:</b> ${customerNoteText}</p>
      <p><b>Total:</b> USD ${totalAmount}</p>
      <hr />
      <p><b>Raw Clover Note:</b></p>
      <pre style="background: #f9f9f9; padding: 10px; white-space: pre-wrap;">${orderNote}</pre>
    </div>
  `,
});

    console.log("✅ Merchant Email Status:", merchantRes.messageId);

    // 8. Send Customer Receipt
    if (buyerEmail) {
      const statusMessage =
        orderType === "PICKUP"
          ? "We are preparing your items for pickup at our store."
          : "We are preparing your items for delivery.";

      const buyerRes = await transporter.sendMail({
        from: `"Kwetu Stores" <${process.env.EMAIL_USER}>`,
        to: buyerEmail,
        subject: `Order Confirmation - Kwetu Stores`,
        html: `
          <div style="font-family: sans-serif; padding: 20px;">
            <h3>Hi ${buyerName},</h3>
            <p>Thank you for your order! We've received your payment of <b>USD ${totalAmount}</b>.</p>
            <p><b>Order ID:</b> ${orderId}</p>
            <p><b>Order Type:</b> ${orderType}</p>
            ${orderType === "DELIVERY" ? `<p><b>Delivery Address:</b> ${deliveryAddress}</p>` : ""}
            <p>${statusMessage}</p>
            ${
              orderType === "PICKUP"
                ? "<p><i>We will notify you as soon as it is ready for collection.</i></p>"
                : ""
            }
          </div>
        `,
      });

      console.log("✅ Buyer Email Status:", buyerRes.messageId);
    }

    return res.status(200).send("SUCCESS");
  } catch (err: any) {
    console.error("❌ Webhook Processing Failed:", err.response?.data || err.message);
    return res.status(200).send("ERROR_LOGGED");
  }
};