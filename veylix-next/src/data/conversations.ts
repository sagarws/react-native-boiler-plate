// @ts-nocheck

export const sampleConversations = [
  {
    id: "chat-1",
    customerId: "customers-1",
    subject: "A quick order question",
    status: "Open",
    channel: "Live chat",
    messages: [
      {
        role: "customer",
        text: "Hi! Could you check the status of my latest order?",
        time: "10:42 AM",
      },
    ],
  },
  {
    id: "chat-2",
    customerId: "customers-2",
    subject: "Finding the right backpack",
    status: "Open",
    channel: "Live chat",
    messages: [
      {
        role: "customer",
        text: "Does the Minimal Backpack have room for my everyday essentials?",
        time: "9:18 AM",
      },
      {
        role: "agent",
        text: "Happy to help. What do you usually carry with you?",
        time: "9:20 AM",
      },
    ],
  },
  {
    id: "chat-3",
    customerId: "customers-3",
    subject: "Thank you!",
    status: "Resolved",
    channel: "Email",
    messages: [
      {
        role: "customer",
        text: "The mug arrived today. It looks lovely!",
        time: "Yesterday",
      },
    ],
  },
  {
    id: "chat-4",
    customerId: "customers-4",
    subject: "Marketplace order update",
    status: "Open",
    channel: "Email",
    messages: [
      {
        role: "customer",
        text: "Could you let me know when this order will leave the warehouse?",
        time: "Yesterday",
      },
    ],
  },
  {
    id: "chat-5",
    customerId: "customers-5",
    subject: "Payment reminder",
    status: "Open",
    channel: "Email",
    messages: [
      {
        role: "customer",
        text: "I saw the payment reminder. Can I still complete this order today?",
        time: "Apr 30",
      },
    ],
  },
  {
    id: "chat-6",
    customerId: "customers-6",
    subject: "Pickup receipt",
    status: "Resolved",
    channel: "Email",
    messages: [
      {
        role: "customer",
        text: "Thanks for arranging the pickup. Please send the receipt when you can.",
        time: "Apr 21",
      },
    ],
  },
  {
    id: "chat-7",
    customerId: "customers-7",
    subject: "Courier delay",
    status: "Open",
    channel: "Live chat",
    messages: [
      {
        role: "customer",
        text: "The tracking has not moved today. Is the parcel still on the way?",
        time: "11:06 AM",
      },
    ],
  },
  {
    id: "chat-8",
    customerId: "customers-8",
    subject: "Cancellation confirmation",
    status: "Resolved",
    channel: "Email",
    messages: [
      {
        role: "customer",
        text: "Thank you for cancelling the order before it shipped.",
        time: "Apr 10",
      },
    ],
  },
];
