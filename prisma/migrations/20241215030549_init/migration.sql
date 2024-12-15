/*
  Warnings:

  - You are about to drop the `Image` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Image" DROP CONSTRAINT "Image_threadId_fkey";

-- DropIndex
DROP INDEX "Thread_threadId_key";

-- DropTable
DROP TABLE "Image";
