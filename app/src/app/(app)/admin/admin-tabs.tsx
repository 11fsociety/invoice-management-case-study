"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UsersTab } from "./tabs/users-tab";
import { ModelTab } from "./tabs/model-tab";
import { ParametersTab } from "./tabs/parameters-tab";

export function AdminTabs() {
  return (
    <Tabs defaultValue="users" className="w-full">
      <TabsList>
        <TabsTrigger value="users">Users</TabsTrigger>
        <TabsTrigger value="model">Model</TabsTrigger>
        <TabsTrigger value="parameters">Parameters</TabsTrigger>
      </TabsList>
      <TabsContent value="users">
        <UsersTab />
      </TabsContent>
      <TabsContent value="model">
        <ModelTab />
      </TabsContent>
      <TabsContent value="parameters">
        <ParametersTab />
      </TabsContent>
    </Tabs>
  );
}
