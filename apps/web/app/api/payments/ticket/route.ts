import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { mintTicket } from "@/utils/stellar";
import { withErrorHandler } from "@/lib/api-handler";
import { throwApiError, ApiError } from "@/lib/api-errors";

type TicketRequestBody = {
  eventId?: string;
  quantity?: number;
  buyerWallet?: string;
};

export const POST = withErrorHandler(async (request: NextRequest) => {
  let payload: TicketRequestBody;
  try {
    payload = await request.json();
  } catch {
    throwApiError("Invalid JSON payload", 400);
  }

  const { eventId, quantity, buyerWallet } = payload;

  // Validation
  if (!eventId || typeof eventId !== "string") {
    throwApiError("Invalid eventId", 400);
  }

  // Ensure quantity is a valid number and cast it for TypeScript safety
  if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity <= 0) {
    throwApiError("Invalid quantity", 400);
  }

  // Type assertion for subsequent logic
  const qty = quantity as number;

  if (!buyerWallet || typeof buyerWallet !== "string") {
    throwApiError("Invalid buyerWallet", 400);
  }

  const event = await prisma.event.findUnique({
    where: { id: eventId },
  });

  if (!event) {
    throwApiError("Event not found", 404);
  }

  // Check ticket availability using Prisma data
  if (event.mintedTickets + qty > event.totalTickets) {
    throwApiError("Not enough tickets available", 409);
  }

  try {
    const mintResult = await mintTicket(eventId, buyerWallet, qty);

    // Atomically update event count and create ticket record
    await prisma.$transaction([
      prisma.event.update({
        where: { id: eventId },
        data: { mintedTickets: { increment: qty } },
      }),
      prisma.ticket.create({
        data: {
          stellarId: mintResult.ticketId,
          eventId,
          buyerWallet,
          quantity: qty,
        },
      }),
    ]);

    return NextResponse.json(
      {
        ticketId: mintResult.ticketId,
        transactionXdr: mintResult.transactionXdr,
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error("Minting Error:", error);
    throwApiError("Failed to mint ticket", 502);
  }
});