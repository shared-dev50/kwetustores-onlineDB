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
        note: address,
      });
    }

    const finalCloverNote = `
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

  // 1. Handshake (Clover verification)
  if (event.verificationCode) return res.status(200).send(event.verificationCode);

  console.log("🚀 Webhook Triggered. Event ID:", event.id);

  try {
    const { token, merchantId } = getCloverConfig();

    // 2. Get the Payment ID from the webhook
    const paymentId = event.id;

    // 3. Fetch the payment details, including metadata
    const paymentResponse = await axios.get(
      `https://apisandbox.dev.clover.com/v3/merchants/${merchantId}/payments/${paymentId}?expand=order`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    const orderId = paymentResponse.data.order?.id;
    if (!orderId) return res.status(200).send("NO_ORDER");

    // 4. Fetch the Order details (note, lineItems, customers)
    const orderResponse = await axios.get(
      `https://apisandbox.dev.clover.com/v3/merchants/${merchantId}/orders/${orderId}?expand=customers,lineItems`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    const orderData = orderResponse.data;

    // 5. Determine the order note (address)
    let orderNote = paymentResponse.data.note || orderData.note || "No address provided";
    if (!orderNote || orderNote === "No address provided") {
      const firstItem = orderData.lineItems?.elements?.[0];
      orderNote = firstItem?.note || "No address found in Order or Line Items";
    }

    // 6. Pull buyer email from metadata first, then fallback to customer
    const buyerEmail =
      paymentResponse.data.metadata?.buyerEmail || // <-- new: metadata from checkout
      orderData.customers?.elements?.[0]?.emailAddresses?.elements?.[0]?.email ||
      "matog50@hotmail.com"; // <-- fallback for testing only

    console.log(`🔍 Order Note: ${orderNote.substring(0, 50)}...`);
    console.log(`🔍 Buyer Email: ${buyerEmail}`);

    // 7. Configure transporter (Gmail or any SMTP)
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true, // SSL
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS, // app password recommended
      },
      debug: true,
      logger: true,
    });

    // 8. Send Merchant Email
    await transporter.sendMail({
      from: `"Kwetu Stores" <${process.env.EMAIL_USER}>`,
      to: process.env.MERCHANT_NOTIFICATION_EMAIL,
      subject: `🚨 Kwetu Order: ${orderId}`,
      html: `<div style="padding:20px; border:1px solid #ddd;">
               <h2>New Order!</h2>
               <p><strong>Note/Address:</strong></p>
               <pre>${orderNote}</pre>
             </div>`,
    });
    console.log("✅ Merchant Email Sent Successfully");

    // 9. Send Buyer Email (if available)
    if (buyerEmail) {
      await transporter.sendMail({
        from: `"Kwetu Stores" <${process.env.EMAIL_USER}>`,
        to: buyerEmail,
        subject: `Your Kwetu Stores Order Confirmation`,
        html: `<p>We received your payment for order <b>${orderId}</b>.</p>
               <p>Details / Address: ${orderNote}</p>`,
      });
      console.log("✅ Buyer Email Sent Successfully");
    }

    return res.status(200).send("SUCCESS");
  } catch (err: any) {
    console.error("❌ WEBHOOK CRASHED:", err.message);
    return res.status(500).send("ERROR");
  }
};