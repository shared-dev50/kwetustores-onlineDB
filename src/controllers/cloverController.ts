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
    // const token = process.env.CLOVER_SECRET?.replace(
    //   /[^\x20-\x7E]/g,
    //   "",
    // ).trim();
    // const merchantId = process.env.CLOVER_MERCHANT_ID?.trim();
    // const frontendUrl = process.env.FRONTEND_URL?.trim();

    // const { items, customer, orderType, address } = req.body;
    const { token, merchantId, ecommUrl, frontendUrl
     } = getCloverConfig();
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
    
   if (orderType === "DELIVERY" && totalItemsCount > 0) {
 
      shippingAmount = totalItemsCount * 700; 

      lineItems.push({
        // id: "P79B9AXNV6BP4", 
        id:"71CZGC2X5GRT2",
        name: "Shipping Fee",
        unitQty: 1, 
        price: shippingAmount, 
        note: `Shipping for ${totalItemsCount} items @ $7.00 each`,
      });
    }

    const finalCloverNote = `
${address} 
---
ITEMS:
${items.map((i: any) => `- ${i.quantity}x ${i.product.name}`).join("\n")}
`.trim();
    const checkoutResponse = await axios.post(
      // "https://api.clover.com/invoicingcheckoutservice/v1/checkouts",
"https://apisandbox.dev.clover.com/invoicingcheckoutservice/v1/checkouts",      {
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
        description:finalCloverNote,
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
      },
    );

    return res.json({
      success: true,
      checkoutUrl: checkoutResponse.data.href,
    });
  // } catch (error: any) {
  //   console.error("Clover API Error:", error.response?.data || error.message);
  //   return res.status(error.response?.status || 500).json({
  //     error: "Could not initialize Clover payment",
  //     details: error.response?.data || null,
  //   });
  // }
  } catch (error: any) {
    console.error("Checkout Error Details:", error.response?.data || error.message);
    res.status(500).json({ error: "Checkout failed" });
  }
};

export const handleCloverWebhook = async (req: Request, res: Response) => {
  const event = req.body;

  // 1. CLOVER HANDSHAKE (Verification)
  if (event.verificationCode) {
    console.log("✅ Clover Handshake Received:", event.verificationCode);
    return res.status(200).send(event.verificationCode);
  }

  // 2. ACKNOWLEDGE RECEIPT (Stops Clover from retrying)
  res.status(200).send("EVENT_RECEIVED");

  console.log("📩 Webhook Received. Full Body:", JSON.stringify(event, null, 2));

  // 3. EXTRACT THE ORDER ID
  // Clover Sandbox often nests data inside 'merchants' or 'data'
  const merchantId = Object.keys(event.merchants || {})[0];
  const updates = event.merchants?.[merchantId];

  if (!updates || !Array.isArray(updates)) {
    console.log("ℹ️ No specific merchant updates found in this ping.");
    return;
  }

  for (const update of updates) {
    // Check for "PAYMENT" (Sandbox) or "PAYMENT_SUCCESS"
    if (update.type === "PAYMENT" || update.type === "PAYMENT_SUCCESS") {
      const orderId = update.objectId;
      console.log(`🚀 Processing Success for Order: ${orderId}`);

      try {
        // --- STEP A: FETCH FULL ORDER FROM CLOVER ---
        // We use apisandbox for testing. Toggle to api.clover.com for production.
        const cloverOrder = await axios.get(
          // `https://api.clover.com/v3/merchants/${process.env.CLOVER_MERCHANT_ID}/orders/${orderId}?expand=customers`,
          `https://apisandbox.dev.clover.com/v3/merchants/${process.env.CLOVER_MERCHANT_ID}/orders/${orderId}?expand=customers,lineItems`,
          {
            headers: {
              Authorization: `Bearer ${process.env.CLOVER_SECRET?.trim()}`,
            },
          }
        );

        const orderData = cloverOrder.data;
        const orderNote = orderData.note || "No specific delivery instructions provided.";
        
        // Extract Email (safely navigating the nested Clover array)
        const customerEmail = 
          orderData.customers?.elements?.[0]?.emailAddresses?.elements?.[0]?.email;

        console.log(`📧 Found Customer Email: ${customerEmail || "Not Found"}`);

        // --- STEP B: TEST TRANSPORTER ---
        await transporter.verify();
        console.log("🔗 SMTP Connection Verified.");

        // --- STEP C: NOTIFY MERCHANT (YOU) ---
        const merchantMail = await transporter.sendMail({
          from: `"Kwetu Order System" <${process.env.EMAIL_USER}>`,
          to: process.env.MERCHANT_NOTIFICATION_EMAIL,
          subject: `🚨 NEW ORDER - ${orderId}`,
          html: `
            <div style="font-family: sans-serif; max-width: 600px; border: 1px solid #eee; padding: 20px;">
              <h2 style="color: #ea580c;">New Sale Confirmed!</h2>
              <p><strong>Order ID:</strong> ${orderId}</p>
              <hr />
              <p><strong>Order Details & Address:</strong></p>
              <div style="background: #f9f9f9; padding: 15px; border-radius: 8px;">
                <pre style="white-space: pre-wrap;">${orderNote}</pre>
              </div>
              <p style="font-size: 12px; color: #666;">Check your Clover dashboard for full line-item breakdown.</p>
            </div>
          `,
        });
        console.log("✅ Merchant Notification Sent:", merchantMail.messageId);

        // --- STEP D: NOTIFY BUYER ---
        if (customerEmail) {
          const buyerMail = await transporter.sendMail({
            from: `"Kwetu Stores" <${process.env.EMAIL_USER}>`,
            to: customerEmail,
            subject: `Order Confirmation - Kwetu Stores`,
            html: `
              <div style="font-family: sans-serif; max-width: 600px; padding: 20px;">
                <h2>Thank you for your order!</h2>
                <p>We've received your payment for order <strong>#${orderId}</strong>.</p>
                <p>Our team is currently preparing your items for delivery/pickup.</p>
                <div style="border-top: 1px solid #eee; padding-top: 10px; margin-top: 20px;">
                  <p><strong>Shipping/Instructions:</strong></p>
                  <p>${orderNote}</p>
                </div>
                <p>If you have any questions, feel free to reply to this email.</p>
              </div>
            `,
          });
          console.log("✅ Buyer Notification Sent:", buyerMail.messageId);
        }

      } catch (err: any) {
        console.error("❌ Webhook Error Detail:", err.response?.data || err.message);
      }
    }
  }
};

