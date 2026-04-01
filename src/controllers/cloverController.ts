import 'dotenv/config';
import type { Request, Response } from "express";
import nodemailer, { type TransportOptions } from "nodemailer";
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
    const { items, customer, orderType, address } = req.body;

    if (!token || !merchantId || !frontendUrl) {
      return res.status(500).json({ error: "Missing server configuration" });
    }

    const totalItemsCount = items.reduce((acc: number, item: any) => acc + item.quantity, 0);

    const lineItems = items.map((item: any) => ({
      name: item.product.name,
      unitQty: item.quantity,
      price: Math.round(item.product.price * 100),
    }));

    // Optional shipping line
    if (orderType === "DELIVERY" && totalItemsCount > 0) {
      lineItems.push({
        id: "71CZGC2X5GRT2", // your shipping item
        name: "Shipping Fee",
        unitQty: totalItemsCount,
        price: 700,
        note: address,
      });
    }

const finalCloverNote = `
ORDER TYPE: ${orderType}
CUSTOMER EMAIL: ${customer.email}
CUSTOMER PHONE: ${customer.phoneNumber}
CUSTOMER NAME: ${customer.firstName} ${customer.lastName}

${address}

---
ITEMS:
${items.map((i: any) => `- ${i.quantity}x ${i.product.name}`).join("\n")}
`.trim();

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
        note: finalCloverNote,
        metadata: {
          buyerEmail: customer.email, // 👈 store buyer email
          address: address,           // 👈 store address
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
    console.error("Checkout Error Details:", error.response?.data || error.message);
    res.status(500).json({ error: "Checkout failed" });
  }
};

export const handleCloverWebhook = async (req: Request, res: Response) => {
  const event = req.body;

  // 1. Handshake (Keep this!)
  if (event.verificationCode) return res.status(200).send(event.verificationCode);

  try {
    // 2. Simplest Transporter (The one that worked first)
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  family: 4, 
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.GOOGLE_PASS,
  },
  debug: true,
  logger:true,
  // This 'family' property is what stops the ENETUNREACH error
} as TransportOptions);

    const merchantId = process.env.CLOVER_MERCHANT_ID;
    const token = process.env.CLOVER_SECRET;
    const paymentId = event.objectId || event.id;

    if (!paymentId || event.type === "PING") return res.status(200).send("OK");

    // 3. Fetch Payment
    const paymentResponse = await axios.get(
      `https://apisandbox.dev.clover.com/v3/merchants/${merchantId}/payments/${paymentId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const paymentData = paymentResponse.data;
    const orderId = paymentData.order?.id || paymentData.orderRef?.id;

    // 4. Fetch Order (Expanded)
    const orderResponse = await axios.get(
      `https://apisandbox.dev.clover.com/v3/merchants/${merchantId}/orders/${orderId}?expand=lineItems,customers`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const orderData = orderResponse.data;

    // 5. THE NOTE HUNT: Search 3 different places for that text string
    let rawNote = orderData.note || ""; 
    
    // If Order Note is empty, check Line Items (Common for Ecommerce API)
    if (!rawNote && orderData.lineItems?.elements) {
      rawNote = orderData.lineItems.elements
        .filter((li: any) => li.note)
        .map((li: any) => li.note)
        .join(" ");
    }
    
    // Still empty? Check the payment note itself
    if (!rawNote) rawNote = paymentData.note || "";

    // 6. Extraction (Matches: CUSTOMER EMAIL: matog50@hotmail.com)
    const emailMatch = rawNote.match(/CUSTOMER EMAIL:\s*([^\s,]+)/i);
    const phoneMatch = rawNote.match(/PHONE:\s*([^\s,]+)/i);
    const nameMatch = rawNote.match(/FULL NAME:\s*(.*)/i);

    const buyerEmail = emailMatch?.[1]?.trim() || null;
    const buyerPhone = phoneMatch?.[1]?.trim() || "N/A";
    const buyerName = nameMatch?.[1]?.trim() || "Customer";

    console.log("📝 Note Found:", rawNote);
    console.log("✅ Parsed Data:", { buyerEmail, buyerPhone, buyerName });

 // 7. Send Merchant Notification Email
    console.log("📨 Attempting to send Merchant Email...");
    const merchantRes = await transporter.sendMail({
      from: `"Kwetu Stores System" <${process.env.EMAIL_USER}>`,
      to: process.env.MERCHANT_NOTIFICATION_EMAIL,
      subject: `🚨 NEW ORDER - KES ${orderData.totalAmount} (${orderId})`,
      html: `<h3>New Order from ${buyerName}</h3><p>${orderData.note}</p>`,
    });
    console.log("✅ Merchant Email Status:", merchantRes.accepted.length > 0 ? "ACCEPTED" : "REJECTED");

    // 8. Send Customer Receipt
    if (buyerEmail) {
      console.log("📨 Attempting to send Buyer Email to:", buyerEmail);
      const buyerRes = await transporter.sendMail({
        from: `"Kwetu Stores" <${process.env.EMAIL_USER}>`,
        to: buyerEmail,
        subject: `Your Kwetu Stores Order - Confirmation`,
        html: `<p>Hi ${buyerName}, we received your order!</p>`,
      });
      console.log("✅ Buyer Email Status:", buyerRes.accepted.length > 0 ? "ACCEPTED" : "REJECTED");
    }

    return res.status(200).send("SUCCESS");

  } catch (err: any) {
    console.error("❌ Webhook Error:", err.message);
    // Returning 200 even on error prevents Clover from retrying a broken event forever
    return res.status(200).send("ERROR_LOGGED"); 
  }
};


export const testEmail = async (req: Request, res: Response) => {
  // 1. Manual Check: Log these to your terminal to see if they are actually loading
  console.log("DEBUG - EMAIL_USER:", process.env.EMAIL_USER);
  console.log("DEBUG - GOOGLE_PASS:", process.env.GOOGLE_PASS ? "Loaded (HIDDEN)" : "NOT LOADED");

  try {
    // 2. Define the transporter inside the function
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.GOOGLE_PASS, 
      },
    });

    // 3. Send the Mail
    const info = await transporter.sendMail({
      from: `"Kwetu Test" <${process.env.EMAIL_USER}>`,
      to: "matog50@hotmail.com",
      subject: "Final Gmail SMTP Test 🚀",
      html: `
        <div style="font-family: sans-serif; padding: 20px;">
          <h2>It's working!</h2>
          <p>This test proves the Gmail SMTP is configured correctly for <b>Kwetu Stores</b>.</p>
        </div>
      `,
    });

    console.log("Message sent successfully: %s", info.messageId);

    return res.json({ 
      success: true, 
      message: "Check your inbox!",
      id: info.messageId 
    });

  } catch (err: any) {
    console.error("Detailed SMTP Error:", err);

    return res.status(500).json({
      success: false,
      message: "SMTP Connection Failed",
      error: err.message,
      code: err.code 
    });
  }
};