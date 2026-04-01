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

  // 1. Clover verification handshake
  if (event.verificationCode) {
    return res.status(200).send(event.verificationCode);
  }

  console.log("🚀 Clover Webhook received:", {
    id: event.id,
    objectId: event.objectId,
    type: event.type,
  });

  try {
    // 2. Use the transporter config that already worked
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.GOOGLE_PASS,
      },
    });

    // Optional but VERY useful for debugging
    await transporter.verify();
    console.log("✅ SMTP transporter verified successfully");

    const merchantId = process.env.CLOVER_MERCHANT_ID;
    const token = process.env.CLOVER_SECRET;
    const paymentId = event.objectId || event.id;

    console.log("🔐 ENV CHECK:", {
      hasMerchantId: !!merchantId,
      hasToken: !!token,
      hasGmailUser: !!process.env.EMAIL_USER,
      hasGmailPass: !!process.env.GOOGLE_PASS,
      merchantNotificationEmail: process.env.MERCHANT_NOTIFICATION_EMAIL,
    });

    if (!paymentId || event.type === "PING") {
      return res.status(200).send("OK");
    }

    // 3. Fetch payment
    const paymentResponse = await axios.get(
      `https://apisandbox.dev.clover.com/v3/merchants/${merchantId}/payments/${paymentId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const paymentData = paymentResponse.data;
    const orderId = paymentData.order?.id || paymentData.orderRef?.id;

    console.log("💳 Payment fetched:", {
      paymentId,
      orderId,
    });

    if (!orderId) {
      console.log("⚠️ No Order ID found for payment:", paymentId);
      return res.status(200).send("NO_ORDER");
    }

    // 4. Fetch order
    const orderResponse = await axios.get(
      `https://apisandbox.dev.clover.com/v3/merchants/${merchantId}/orders/${orderId}?expand=lineItems,customers`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const orderData = orderResponse.data;

    // 5. Hunt for note in multiple places
    let rawNote = orderData.note || "";

    if (!rawNote && orderData.lineItems?.elements) {
      rawNote = orderData.lineItems.elements
        .filter((li: any) => li.note)
        .map((li: any) => li.note)
        .join(" ");
    }

    if (!rawNote) {
      rawNote = paymentData.note || "";
    }

    // 6. Parse data from note
    const emailMatch = rawNote.match(/CUSTOMER EMAIL:\s*([^\s,|]+)/i);
    const phoneMatch = rawNote.match(/PHONE:\s*([^\s,|]+)/i);
    const nameMatch = rawNote.match(/FULL NAME:\s*(.+?)(?:\s*(?:PHONE:|CUSTOMER EMAIL:|ADDRESS:|$))/i);

    const buyerEmail =
      paymentData.receipt_email ||
      emailMatch?.[1]?.trim() ||
      null;

    const buyerPhone = phoneMatch?.[1]?.trim() || "N/A";
    const buyerName = nameMatch?.[1]?.trim() || "Customer";
    const totalAmount = (orderData.total || paymentData.amount || 0) / 100;

    console.log("📝 Raw Note:", rawNote);
    console.log("✅ Parsed Data:", {
      buyerEmail,
      buyerPhone,
      buyerName,
      totalAmount,
    });

    // 7. Send merchant email
    console.log("📨 Sending merchant email...");

    const merchantRes = await transporter.sendMail({
      from: `"Kwetu Stores System" <${process.env.EMAIL_USER}>`,
      to: process.env.MERCHANT_NOTIFICATION_EMAIL,
      subject: `🚨 NEW ORDER - $ ${totalAmount} (${orderId})`,
      html: `
        <div style="font-family: sans-serif; border: 1px solid #eee; padding: 20px;">
          <h2 style="color: #2e7d32;">New Payment Received!</h2>
          <p><b>Order ID:</b> ${orderId}</p>
          <p><b>Amount:</b> $ ${totalAmount}</p>
          <p><b>Customer Name:</b> ${buyerName}</p>
          <p><b>Customer Email:</b> ${buyerEmail || "Unknown"}</p>
          <p><b>Customer Phone:</b> ${buyerPhone}</p>
          <p><b>Raw Note:</b></p>
          <blockquote style="background: #f9f9f9; padding: 10px;">${rawNote || "No note found"}</blockquote>
          <br/>
          <a href="https://sandbox.clover.com/manage/m/${merchantId}/orders/${orderId}" 
             style="background: #000; color: #fff; padding: 10px 20px; text-decoration: none;">
             View in Clover Dashboard
          </a>
        </div>
      `,
    });

    console.log("✅ Merchant email sent:", merchantRes.messageId);

    // 8. Send buyer email
    if (buyerEmail) {
      console.log("📨 Sending customer email to:", buyerEmail);

      const buyerRes = await transporter.sendMail({
        from: `"Kwetu Stores" <${process.env.EMAIL_USER}>`,
        to: buyerEmail,
        subject: `Your Kwetu Stores Order - Confirmation`,
        html: `
          <h3>Thank you for shopping with Kwetu Stores!</h3>
          <p>Hi ${buyerName},</p>
          <p>We've received your payment of <b>KES ${totalAmount}</b>.</p>
          <p><b>Order ID:</b> ${orderId}</p>
          <p>We are preparing your items for delivery.</p>
        `,
      });

      console.log("✅ Buyer email sent:", buyerRes.messageId);
    } else {
      console.log("⚠️ No buyer email found, skipping customer email");
    }

    return res.status(200).send("SUCCESS");
  } catch (err: any) {
    console.error("❌ Webhook Processing Failed");
    console.error("Message:", err.message);
    console.error("Response Data:", err.response?.data);
    console.error("Full Error:", err);

    // Return 200 so Clover doesn't keep retrying forever
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