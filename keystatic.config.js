import { config, collection, fields } from "@keystatic/core";

export default config({
  storage: { kind: "local" },
  ui: {
    brand: {
      name: "AC Blog",
    },
    navigation: ["posts"],
  },
  collections: {
    posts: collection({
      label: "Blog posts",
      path: "blog/content/posts/*",
      slugField: "slug",
      format: { data: "json" },
      schema: {
        slug: fields.slug({
          name: {
            label: "Title",
            validation: { isRequired: true, length: { min: 5 } },
          },
          slug: {
            label: "Slug",
            validation: {
              length: { min: 5 },
              pattern: {
                regex: /^[a-z0-9-]+$/,
                message: "Use kebab-case (letters, numbers, hyphens).",
              },
            },
          },
        }),
        title: fields.text({
          label: "Display title",
          validation: { isRequired: true },
        }),
        summary: fields.text({
          label: "Summary",
          multiline: true,
          validation: { isRequired: true, length: { min: 10 } },
        }),
        date: fields.date({ label: "Publish date", validation: { isRequired: true } }),
        readingTime: fields.text({ label: "Reading time" }),
        category: fields.select({
          label: "Category",
          options: [
            { label: "Technical", value: "technical" },
            { label: "Reflection", value: "reflection" },
            { label: "Hobby", value: "hobby" },
            { label: "Personal", value: "personal" },
          ],
          defaultValue: "technical",
        }),
        topics: fields.array(fields.text({ label: "Topic" }), {
          label: "Topics",
          itemLabel: (props) => props.value || "Topic",
          validation: { length: { min: 1 } },
        }),
        canonicalUrl: fields.url({ label: "Canonical URL" }),
        heroImage: fields.url({ label: "OG image" }),
        heroAlt: fields.text({ label: "OG image alt" }),
        body: fields.text({ label: "Body", multiline: true }),
      },
    }),
  },
});
