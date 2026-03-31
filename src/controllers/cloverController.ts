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
        unitQty: totalItemsCount, 
        price: 700, 
        note: address
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
  
  // 1. Handshake
  if (event.verificationCode) return res.status(200).send(event.verificationCode);

  console.log("🚀 Webhook Triggered. Event ID:", event.id);

  try {
    const { token, merchantId } = getCloverConfig();

 const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    debug: true,
    logger: true,
  });
    // 3. Get the Order ID from the payment
    const paymentId = event.id;
    const paymentResponse = await axios.get(
      `https://apisandbox.dev.clover.com/v3/merchants/${merchantId}/payments/${paymentId}?expand=order`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    const orderId = paymentResponse.data.order?.id;
    if (!orderId) return res.status(200).send("NO_ORDER");

    // 4. Fetch the Order AND the Line Items (to find the note)
    const cloverOrder = await axios.get(
      `https://apisandbox.dev.clover.com/v3/merchants/${merchantId}/orders/${orderId}?expand=customers,lineItems`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

   // 1. Check Order Note
   const orderData = cloverOrder.data;
let orderNote = orderData.note;

// 2. Fallback: Check Line Item Notes (Common in Clover Sandbox)
if (!orderNote || orderNote === "No address provided") {
  const firstItem = orderData.lineItems?.elements?.[0];
  orderNote = firstItem?.note || "No address found in Order or Line Items";
}

// 3. Buyer Email Fallback
// If the customer isn't linked to the order, check the payment's receipt email
const buyerEmail = 
  orderData.customers?.elements?.[0]?.emailAddresses?.elements?.[0]?.email || 
  paymentResponse.data.receiptEmail; // Note: it's receiptEmail (no underscore) in some API versions

    console.log(`🔍 Order Note found: ${orderNote.substring(0, 20)}...`);
    console.log(`🔍 Buyer Email identified: ${buyerEmail || "NONE FOUND"}`);

    // 5. SEND MERCHANT EMAIL
    console.log("📤 Attempting Merchant Email...");
    await transporter.sendMail({
      from: `"Kwetu Stores" <${process.env.EMAIL_USER}>`,
      to: process.env.MERCHANT_NOTIFICATION_EMAIL,
      subject: `🚨 Kwetu Order: ${orderId}`,
      html: `<div style="padding:20px; border:1px solid #ddd;">
              <h2>New Order!</h2>
              <p><strong>Note/Address:</strong></p>
              <pre>${orderNote}</pre>
             </div>`
    });
    console.log("✅ Merchant Email Sent Successfully");

    // 6. SEND BUYER EMAIL (If email exists)
    if (buyerEmail) {
      await transporter.sendMail({
        from: `"Kwetu Stores" <${process.env.EMAIL_USER}>`,
        to: buyerEmail,
        subject: `Your Kwetu Stores Order Confirmation`,
        html: `<p>We received your payment for order <b>${orderId}</b>.</p><p>Instructions: ${orderNote}</p>`
      });
      console.log("✅ Buyer Email Sent Successfully");
    }

    return res.status(200).send("SUCCESS");

  } catch (err: any) {
    console.error("❌ WEBHOOK CRASHED:", err.message);
    return res.status(500).send("ERROR");
  }
};
