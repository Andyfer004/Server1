-- CreateTable
CREATE TABLE "Thread" (
    "id" SERIAL NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Thread_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Thread_phoneNumber_key" ON "Thread"("phoneNumber");
