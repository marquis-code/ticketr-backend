import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';
import * as https from 'https';
import * as http from 'http';

@Injectable()
export class TicketGeneratorService {
  private readonly logger = new Logger(TicketGeneratorService.name);

  /**
   * Downloads an image from a URL and returns it as a Buffer.
   */
  private async downloadImage(url: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;
      client.get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return this.downloadImage(res.headers.location!).then(resolve).catch(reject);
        }
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      }).on('error', reject);
    });
  }

  /**
   * Generates a customized ticket image by compositing the attendee name
   * and QR code onto the template image.
   */
  async generateTicketImage(params: {
    templateImageUrl: string;
    attendeeName: string;
    ticketNumber: string;
    qrCodeHash: string;
    departmentCode?: string;
  }): Promise<Buffer> {
    // 1. Download the template image
    const templateBuffer = await this.downloadImage(params.templateImageUrl);
    const metadata = await sharp(templateBuffer).metadata();
    const imgWidth = metadata.width || 1500;
    const imgHeight = metadata.height || 600;

    // 2. Generate QR code as PNG buffer
    const qrSize = Math.round(Math.min(imgWidth, imgHeight) * 0.22);
    const qrBuffer = await QRCode.toBuffer(params.qrCodeHash, {
      width: qrSize,
      margin: 1,
      color: { dark: '#1a1a1a', light: '#ffffff' },
      errorCorrectionLevel: 'H',
    });

    // 3. Create name overlay as SVG -> PNG
    const fontSize = Math.round(imgHeight * 0.055);
    const nameText = params.attendeeName.toUpperCase();
    const nameSvg = Buffer.from(`
      <svg width="${imgWidth}" height="${Math.round(fontSize * 2.5)}">
        <style>
          .name { font-family: sans-serif; font-weight: 800; font-size: ${fontSize}px; fill: #FFD700; text-shadow: 2px 2px 4px rgba(0,0,0,0.8); }
        </style>
        <text x="${Math.round(imgWidth * 0.45)}" y="${Math.round(fontSize * 1.5)}" text-anchor="middle" class="name">${this.escapeXml(nameText)}</text>
      </svg>
    `);
    const nameOverlay = await sharp(nameSvg).png().toBuffer();

    // 4. Create ticket number overlay
    const ticketFontSize = Math.round(imgHeight * 0.035);
    const ticketSvg = Buffer.from(`
      <svg width="${imgWidth}" height="${Math.round(ticketFontSize * 2.5)}">
        <style>
          .ticket-num { font-family: monospace; font-weight: 700; font-size: ${ticketFontSize}px; fill: #ffffff; text-shadow: 1px 1px 3px rgba(0,0,0,0.8); }
        </style>
        <text x="${Math.round(imgWidth * 0.45)}" y="${Math.round(ticketFontSize * 1.5)}" text-anchor="middle" class="ticket-num">TICKET: ${this.escapeXml(params.ticketNumber)}</text>
      </svg>
    `);
    const ticketOverlay = await sharp(ticketSvg).png().toBuffer();

    // Create department code overlay if provided
    let deptOverlay: Buffer | null = null;
    let deptNumTop = 0;
    if (params.departmentCode) {
      const deptSvg = Buffer.from(`
        <svg width="${imgWidth}" height="${Math.round(ticketFontSize * 2.5)}">
          <style>
            .dept-num { font-family: sans-serif; font-weight: 700; font-size: ${Math.round(ticketFontSize * 0.9)}px; fill: #FFD700; text-shadow: 1px 1px 3px rgba(0,0,0,0.8); }
          </style>
          <text x="${Math.round(imgWidth * 0.45)}" y="${Math.round(ticketFontSize * 1.5)}" text-anchor="middle" class="dept-num">DEPT: ${this.escapeXml(params.departmentCode.toUpperCase())}</text>
        </svg>
      `);
      deptOverlay = await sharp(deptSvg).png().toBuffer();
      deptNumTop = Math.round(imgHeight * 0.16); // Below ticket number
    }

    // 5. Add white background behind QR code
    const qrPadding = Math.round(qrSize * 0.1);
    const qrWithBg = await sharp({
      create: {
        width: qrSize + qrPadding * 2,
        height: qrSize + qrPadding * 2,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 255 },
      },
    })
      .composite([{ input: qrBuffer, top: qrPadding, left: qrPadding }])
      .png()
      .toBuffer();

    // 6. Composite everything onto the template
    // Place name at ~6% from top, centered horizontally (shifted slightly left to account for stub)
    // Place QR at bottom of the right stub (~72% from top, ~87% from left)
    const nameTop = Math.round(imgHeight * 0.04);
    const ticketNumTop = Math.round(imgHeight * 0.11);
    const qrTop = Math.round(imgHeight * 0.72);
    const qrLeft = Math.round(imgWidth * 0.87 - (qrSize + qrPadding * 2) / 2);

    const composites: any[] = [
      { input: nameOverlay, top: nameTop, left: 0 },
      { input: ticketOverlay, top: ticketNumTop, left: 0 },
      { input: qrWithBg, top: qrTop, left: qrLeft },
    ];
    
    if (deptOverlay) {
      composites.push({ input: deptOverlay, top: deptNumTop, left: 0 });
    }

    const composited = await sharp(templateBuffer)
      .composite(composites)
      .png()
      .toBuffer();

    return composited;
  }

  /**
   * Generates a PDF containing the customized ticket image.
   */
  async generateTicketPdf(params: {
    ticketImageBuffer: Buffer;
    attendeeName: string;
    eventName: string;
    eventDate: string;
    eventLocation: string;
    ticketNumber: string;
    tierName: string;
  }): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      // Landscape A5 for a nice ticket look
      const doc = new PDFDocument({
        size: [595.28, 350],
        margin: 0,
        info: {
          Title: `${params.eventName} - ${params.tierName} Ticket`,
          Author: 'Ticketr Platform',
          Subject: `Ticket for ${params.attendeeName}`,
        },
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Draw the ticket image filling the page
      doc.image(params.ticketImageBuffer, 0, 0, {
        width: 595.28,
        height: 350,
        fit: [595.28, 350],
        align: 'center',
        valign: 'center',
      });

      // Small footer text
      doc
        .fontSize(7)
        .fillColor('#999999')
        .text('Generated by Ticketr | www.ticketr.org', 10, 335, { width: 575, align: 'center' });

      doc.end();
    });
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
