---
title: Architecture Decision Records
---

<script setup>
import { data as adrs } from './adr.data.ts'
</script>

# Architecture Decision Records

This page lists the architecture decision records (ADRs) for Autonomous Operations. Each ADR records one decision, the options considered, and the trade-offs accepted.

## Records

<table>
  <thead>
    <tr>
      <th>ID</th>
      <th>Title</th>
      <th>Status</th>
      <th>Date</th>
    </tr>
  </thead>
  <tbody>
    <tr v-if="adrs.length === 0">
      <td colspan="4">No ADRs yet.</td>
    </tr>
    <tr v-for="adr in adrs" :key="adr.id">
      <td>{{ adr.id }}</td>
      <td><a :href="adr.url">{{ adr.title }}</a></td>
      <td>{{ adr.status }}</td>
      <td>{{ adr.date }}</td>
    </tr>
  </tbody>
</table>
