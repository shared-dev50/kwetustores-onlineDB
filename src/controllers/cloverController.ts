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
      });
    }

const finalCloverNote = `
ORDER TYPE: ${orderType}
${orderType === "DELIVERY" ? `SHIP TO: ${address}` : "PICKUP AT STORE"}

CUSTOMER EMAIL: ${customer.email}
PHONE: ${customer.phoneNumber}
FULL NAME: ${customer.firstName} ${customer.lastName}
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
        note: address,
      metadata: {
          orderType: orderType,
          customerEmail: customer.email
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

  // 1. Clover Handshake
  if (event.verificationCode) {
    return res.status(200).send(event.verificationCode);
  }

  console.log("🚀 Clover Webhook received. Event ID:", event.id || event.objectId);

  // 2. Setup Transporter OUTSIDE the try/catch for stability
  // Using 'as any' to bypass TypeScript strictness on the 'family' property
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.GOOGLE_PASS, // Your 16-character App Password
    },
    family: 4, // CRITICAL: Forces IPv4 to prevent ENETUNREACH in Kenya
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

    // 4. Fetch Full Order
    const orderResponse = await axios.get(
      `https://apisandbox.dev.clover.com/v3/merchants/${merchantId}/orders/${orderId}?expand=lineItems,customers`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const orderData = orderResponse.data;

    // 5. THE NOTE HUNT (Address, Email, Phone extraction)
    // 5. THE SMART NOTE HUNT
   // 5. THE ULTIMATE NOTE & DATA HUNT
    // 5. THE ULTIMATE HUNT
    const rawNotes = [
      orderData.note,
      paymentData.note,
      event.note,
      ...(orderData.lineItems?.elements?.map((li: any) => li.note) || [])
    ];

    const uniqueNotes = [...new Set(
      rawNotes.filter(n => n && typeof n === 'string' && n.trim() !== "").map(n => n.trim())
    )];

    let orderNote = uniqueNotes.length > 0 ? uniqueNotes[0] : "";

    // 6. FALLBACK PARSING
    const emailMatch = orderNote.match(/CUSTOMER EMAIL:\s*([^\s,]+)/i);
    const phoneMatch = orderNote.match(/PHONE:\s*([^\s,]+)/i);
    const nameMatch = orderNote.match(/FULL NAME:\s*([^\n\r|]+)/i);

    // If Note is empty, pull from Clover's expanded Customer object
    const cloverCust = orderData.customers?.elements?.[0];

    const buyerEmail = emailMatch?.[1]?.trim() || cloverCust?.emailAddresses?.[0]?.email || "Unknown";
    const buyerPhone = phoneMatch?.[1]?.trim() || cloverCust?.phoneNumbers?.[0]?.phoneNumber || "N/A";
    
    let buyerName = "Customer";
    if (nameMatch?.[1]) {
      buyerName = nameMatch[1].split(/ORDER TYPE/i)[0].trim();
    } else if (cloverCust) {
      buyerName = `${cloverCust.firstName || ""} ${cloverCust.lastName || ""}`.trim();
    }

    // Determine Pickup vs Delivery even if note is empty
    const isPickup = orderNote.toUpperCase().includes("PICKUP") || orderNote === "";
    
    // If we still have no note text, at least tell the staff it's a Pickup
    if (!orderNote) orderNote = isPickup ? "ORDER TYPE: PICKUP (No additional notes)" : "No customer notes found.";
    const totalAmount = orderData.total / 100;

    console.log("📝 Note Found:", orderNote);
    console.log("✅ Parsed Data:", { buyerEmail, buyerPhone, buyerName });

    // 7. Send Merchant Notification
    console.log("📨 Attempting to send Merchant Email...");
    const merchantRes = await transporter.sendMail({
      from: `"Kwetu Stores System" <${process.env.EMAIL_USER}>`,
      to: process.env.MERCHANT_NOTIFICATION_EMAIL,
      subject: `🚨 NEW ORDER - $ ${totalAmount} (${orderId})`,
      html: `
        <div style="font-family: sans-serif; border: 1px solid #eee; padding: 20px;">
          <h2 style="color: #2e7d32;">New Payment Received!</h2>
          <p><b>Customer:</b> ${buyerName}</p>
          <p><b>Email:</b> ${buyerEmail || "Unknown"}</p>
          <p><b>Phone:</b> ${buyerPhone}</p>
          <p><b>Total:</b> $ ${totalAmount}</p>
          <hr />
          <p><b>Order Note / Address:</b></p>
          <pre style="background: #f9f9f9; padding: 10px; white-space: pre-wrap;">${orderNote}</pre>
        </div>
      `,
    });
    console.log("✅ Merchant Email Status: ACCEPTED", merchantRes.messageId);

    // 8. Send Customer Receipt
    // 8. Send Customer Receipt
    if (buyerEmail && buyerEmail !== "Unknown") {
      // Detect Order Type from the note or default to DELIVERY
      const isPickup = orderNote.toUpperCase().includes("ORDER TYPE: PICKUP");
      const statusMessage = isPickup 
        ? "We are preparing your items for pickup at our store." 
        : "We are preparing your items for delivery.";

      console.log(`📨 Sending ${isPickup ? 'PICKUP' : 'DELIVERY'} email to:`, buyerEmail);

      const buyerRes = await transporter.sendMail({
        from: `"Kwetu Stores" <${process.env.EMAIL_USER}>`,
        to: buyerEmail,
        subject: `Order Confirmation - Kwetu Stores`,
        html: `
          <div style="font-family: sans-serif; padding: 20px;">
            <h3>Hi ${buyerName},</h3>
            <p>Thank you for your order! We've received your payment of <b>$ ${totalAmount}</b>.</p>
            <p><b>Order ID:</b> ${orderId}</p>
            <p>${statusMessage}</p>
            ${isPickup ? '<p><i>We will notify you as soon as it is ready for collection.</i></p>' : ''}
          </div>
        `,
      });
      console.log("✅ Buyer Email Status: ACCEPTED", buyerRes.messageId);
    }

    // 9. Final Response to Clover
    return res.status(200).send("SUCCESS");

  } catch (err: any) {
    console.error("❌ Webhook Processing Failed:", err.message);
    // Always return 200 to Clover so it doesn't spam your endpoint with retries
    return res.status(200).send("ERROR_LOGGED");
  }
};


