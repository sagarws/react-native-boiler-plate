// @ts-nocheck
import {
  createField,
  createModule,
  createResourceModule,
  dateField,
  nameField,
  numberField,
  selectField,
  statusField,
  textField,
} from "@/config/modules/fields";

const blogCategoriesModule = createResourceModule(
  "blog-categories",
  "Blog categories",
  "Reusable categories for blog posts.",
  [
    nameField,
    textField("slug", "URL slug", {
      required: true,
      unique: true,
    }),
    createField("description", "Description", "textarea"),
    statusField(["Active", "Inactive"]),
  ],
  [
    {
      name: "Journal",
      slug: "journal",
      description: "Stories, ideas and updates from the store.",
      status: "Active",
    },
    {
      name: "Guides",
      slug: "guides",
      description: "Helpful buying, styling and product guides.",
      status: "Active",
    },
    {
      name: "Behind the scenes",
      slug: "behind-the-scenes",
      description: "A closer look at the people and process behind the store.",
      status: "Active",
    },
  ],
  {
    hidden: true,
  },
);

const testimonialCategoriesModule = createResourceModule(
  "testimonial-categories",
  "Testimonial categories",
  "Reusable categories for customer testimonials.",
  [
    nameField,
    textField("subtitle", "Subtitle"),
    createField("description", "Description", "textarea"),
    statusField(["Active", "Inactive"]),
  ],
  [
    {
      name: "Customer stories",
      subtitle: "",
      description: "Real customer experiences and brand stories.",
      status: "Active",
    },
    {
      name: "Product feedback",
      subtitle: "",
      description:
        "Testimonials focused on product quality, fit or usefulness.",
      status: "Active",
    },
    {
      name: "Service experience",
      subtitle: "",
      description:
        "Feedback about support, delivery and the buying experience.",
      status: "Active",
    },
  ],
  {
    hidden: true,
  },
);

export const onlineStoreModules = [
  createModule(
    "store",
    "Online store",
    "The little details that make your storefront feel like you.",
    "store",
  ),
  createModule(
    "menus",
    "Menus & mega menus",
    "Build a clear path through your store, with up to three levels.",
    "menus",
  ),
  createResourceModule(
    "pages",
    "Store pages",
    "Build useful pages from simple, reusable content blocks.",
    [
      nameField,
      textField("slug", "URL slug", {
        required: true,
        unique: true,
      }),
      textField("seoTitle", "SEO title"),
      createField("seoDescription", "SEO description", "textarea"),
      statusField(["Draft", "Published", "Hidden"]),
    ],
    [
      {
        name: "Our story",
        slug: "our-story",
        seoTitle: "Our story | Veylix",
        status: "Published",
        blocks: [
          {
            type: "Hero",
            title: "Good things, made for everyday.",
            body: "A small collection of thoughtfully made essentials.",
          },
          {
            type: "Text",
            title: "Less, but better.",
            body: "We work with independent makers who care about the details as much as we do.",
          },
        ],
      },
      {
        name: "Shipping & returns",
        slug: "shipping-returns",
        status: "Draft",
        blocks: [
          {
            type: "FAQ",
            title: "When will my order arrive?",
            body: "Most orders leave our studio within two business days.",
          },
        ],
      },
    ],
    {
      editor: "page",
    },
  ),
  blogCategoriesModule,
  createResourceModule(
    "blog",
    "Blog posts",
    "Stories, advice and a little inspiration for your customers.",
    [
      nameField,
      textField("slug", "URL slug", {
        unique: true,
      }),
      textField("author", "Author"),
      createField("category", "Category", "text", {
        relation: "blog-categories",
        required: true,
      }),
      createField("imageId", "Featured image", "content-image"),
      createField("content", "Article", "textarea"),
      dateField("published", "Publish date"),
      statusField(["Draft", "Published", "Scheduled"]),
    ],
    [
      {
        name: "Small rituals, better mornings",
        slug: "better-mornings",
        author: "Alex Chen",
        category: "blog-categories-1",
        imageId: "",
        content:
          "Start slowly. Choose a favorite mug. Make a little space for the day ahead.",
        published: "2026-04-28",
        status: "Published",
      },
      {
        name: "The everyday bag guide",
        slug: "everyday-bag-guide",
        author: "Mia Foster",
        category: "blog-categories-2",
        imageId: "",
        content: "Find a bag that fits the way you move.",
        status: "Draft",
      },
    ],
    {
      columns: ["name", "imageId", "category", "published", "status"],
      addLabel: "blog post",
      imageFolder: "Blog posts",
      categoryManager: {
        id: "blog-categories",
        eyebrow: "SET UP CATEGORIES FIRST",
        title: "Blog categories",
        description:
          "Organize articles into reusable categories that can grow with your storefront.",
      },
    },
  ),
  testimonialCategoriesModule,
  createResourceModule(
    "testimonials",
    "Testimonials",
    "A few kind words from the people who know your store best.",
    [
      nameField,
      textField("subtitle", "Subtitle"),
      createField("category", "Category", "text", {
        relation: "testimonial-categories",
        required: true,
      }),
      createField("imageId", "Customer image", "content-image"),
      createField("quote", "Quote", "textarea", {
        required: true,
      }),
      numberField("rating", "Rating", {
        min: 1,
        max: 5,
        integer: true,
      }),
      statusField(["Published", "Draft"]),
    ],
    [
      {
        name: "Sarah Kim",
        subtitle: "Veylix customer",
        category: "testimonial-categories-1",
        imageId: "",
        quote: "Considered details, beautiful quality. I keep coming back.",
        rating: 5,
        status: "Published",
      },
    ],
    {
      columns: ["name", "imageId", "category", "rating", "status"],
      addLabel: "testimonial",
      imageFolder: "Testimonials",
      categoryManager: {
        id: "testimonial-categories",
        eyebrow: "SET UP CATEGORIES FIRST",
        title: "Testimonial categories",
        description:
          "Group customer feedback by story type so testimonials stay easy to manage and reuse.",
      },
    },
  ),
  createResourceModule(
    "contacts",
    "Contact messages",
    "Keep customer questions from falling through the gaps.",
    [
      nameField,
      textField("email", "Email", {
        type: "email",
      }),
      textField("subject", "Subject"),
      createField("message", "Message", "textarea"),
      statusField(["New", "In progress", "Resolved"]),
      createField("reply", "Reply draft", "textarea"),
    ],
    [
      {
        name: "Taylor Brooks",
        email: "taylor@example.com",
        subject: "Wholesale inquiry",
        message: "Do you offer wholesale pricing for your ceramic range?",
        status: "New",
      },
    ],
  ),
  createResourceModule(
    "popups",
    "Popups & announcements",
    "Helpful messages, timed with care.",
    [
      nameField,
      textField("headline", "Headline"),
      createField("message", "Message", "textarea"),
      selectField("trigger", "Show when", [
        "After 10 seconds",
        "Exit intent",
        "First visit",
        "After scrolling",
      ]),
      textField("button", "Button label"),
      textField("destination", "Destination path"),
      statusField(["Draft", "Active", "Paused"]),
    ],
    [
      {
        name: "First hello",
        headline: "A warm welcome, and 10% off.",
        message:
          "Join our list for good things, new arrivals and a little inspiration.",
        trigger: "First visit",
        button: "Join the list",
        destination: "/newsletter",
        status: "Draft",
      },
    ],
  ),
];
