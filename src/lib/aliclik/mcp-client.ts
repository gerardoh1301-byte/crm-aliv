/**
 * Cliente oficial para Aliclik MCP Logistics & Fulfillment
 * Conecta el CRM con la plataforma logística de Aliclik usando su endpoint MCP oficial.
 */

export interface AliclikOrderItem {
  orderNumber: string;
  createdAt: string;
  callStatus: string;
  deliveryStatus: string;
  customerName: string;
  customerPhone: string;
  district: string | null;
  total: number;
  deliveryType: "CASH_ON_DELIVERY" | "AGENCY";
  agency: string | null;
  trackingStatus: string | null;
  callStatusLabel: string;
  deliveryStatusLabel: string;
  deliveryTypeLabel: string;
  trackingStatusLabel: string | null;
}

export interface AliclikOrderDetails {
  orderNumber: string;
  createdAt: string;
  callStatus: string;
  deliveryStatus: string;
  deliveryType: string;
  agency: string | null;
  trackingStatus: string | null;
  customer: {
    name: string;
    phone: string;
  };
  shipping: {
    department: string | null;
    province: string | null;
    district: string | null;
    address: string;
    reference: string;
    scheduledDate: string | null;
  };
  productsText: string;
  lines: Array<{
    product: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
  }>;
  total: number;
  shippingCost: number;
  callStatusLabel: string;
  deliveryStatusLabel: string;
  deliveryTypeLabel: string;
  trackingStatusLabel: string | null;
}

export class AliclikMcpClient {
  private url: string;
  private token: string;

  constructor(options?: { url?: string; token?: string }) {
    this.url = options?.url || process.env.ALICLIK_MCP_URL || "https://mcp.aliclik.app/mcp";
    this.token = options?.token || process.env.ALICLIK_MCP_TOKEN || "";
    if (this.token && !this.token.startsWith("Bearer ")) {
      this.token = `Bearer ${this.token}`;
    }
  }

  private async callTool<T>(toolName: string, args: Record<string, unknown>): Promise<T> {
    if (!this.token) {
      throw new Error("ALICLIK_MCP_TOKEN no configurado");
    }

    const res = await fetch(this.url, {
      method: "POST",
      headers: {
        Authorization: this.token,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/call",
        params: {
          name: toolName,
          arguments: args,
        },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Aliclik MCP Error ${res.status}: ${err}`);
    }

    // El servidor MCP puede responder JSON o un flujo SSE ("event: message / data: {...}").
    const crudo = await res.text();
    let data: { result?: { content?: Array<{ text?: string }> }; error?: { message?: string } };
    try {
      data = JSON.parse(crudo);
    } catch {
      const lineas = crudo
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .filter(Boolean);
      if (!lineas.length) throw new Error(`Aliclik MCP: respuesta no reconocida (${crudo.slice(0, 120)})`);
      data = JSON.parse(lineas[lineas.length - 1]);
    }
    if (data.error) {
      throw new Error(`Aliclik MCP Tool Error: ${data.error.message || JSON.stringify(data.error)}`);
    }

    const contentText = data.result?.content?.[0]?.text;
    if (!contentText) {
      return data.result as T;
    }

    try {
      return JSON.parse(contentText) as T;
    } catch {
      return contentText as unknown as T;
    }
  }

  /**
   * Busca pedidos registrados en Aliclik en un rango de fechas.
   */
  async searchOrders(params: {
    from: string; // YYYY-MM-DD
    to: string; // YYYY-MM-DD
    callStatus?: string;
    deliveryStatus?: string;
    deliveryType?: "CASH_ON_DELIVERY" | "AGENCY";
    phone?: string;
    district?: string;
    orderNumber?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{ total: number; page: number; pageSize: number; items: AliclikOrderItem[] }> {
    return this.callTool<{ total: number; page: number; pageSize: number; items: AliclikOrderItem[] }>(
      "search_orders",
      params as Record<string, unknown>
    );
  }

  /**
   * Obtiene el detalle completo de un pedido específico por su número (ej. "ERG7355935").
   */
  async getOrder(orderNumber: string): Promise<AliclikOrderDetails> {
    return this.callTool<AliclikOrderDetails>("get_order", { orderNumber });
  }

  /**
   * Resumen del embudo de pedidos de Aliclik.
   */
  async summarizeOrders(params: { from: string; to: string }): Promise<unknown> {
    return this.callTool("summarize_orders", params);
  }

  /**
   * Consulta agregada multidimensional de pedidos en Aliclik.
   */
  async queryOrders(params: Record<string, unknown>): Promise<unknown> {
    return this.callTool("query_orders", params);
  }
}

export const aliclik = new AliclikMcpClient();
