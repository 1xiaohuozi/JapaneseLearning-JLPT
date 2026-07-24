# 日语备考通（JapaneseLearning-JLPT）

[English](README.md) | [日本語](README.ja.md) | 简体中文

![日语学习小程序](assets/cover.png)

这是一个面向JLPT备考的微信小程序，包含单词、语法、听力跟读、学习记录、复习统计、个人主页和排行榜等功能。

## 项目截图

| 单词学习 | 语法学习 |
| --- | --- |
| ![单词学习](assets/screenshot-01.png) | ![语法学习](assets/screenshot-02.png) |

## 主要功能

- JLPT N1、N2、N3、N4/N5分级单词学习
- 语法浏览、深度学习和语法收藏
- 听力跟读和学习进度记录
- 学习计划、复习统计和记忆保持相关工具
- 用户登录、个人学习台和排行榜
- JLPT N1至N5估分页面
- 微信云开发数据库和云函数

## 技术栈

- 微信小程序
- JavaScript、WXML、WXSS
- 微信云开发（CloudBase）
- Node.js云函数
- `wx-server-sdk`

## 运行要求

- 微信开发者工具
- 微信小程序AppID
- 微信云开发环境
- Node.js

## 安装与配置

1. 克隆仓库：

   ```bash
   git clone https://github.com/1xiaohuozi/JapaneseLearning-JLPT.git
   cd JapaneseLearning-JLPT
   ```

2. 使用微信开发者工具导入仓库根目录。
3. 创建或选择一个云开发环境。
4. 将以下文件中的环境ID替换为你自己的环境ID：

   - `miniprogram/app.js`
   - `miniprogram/envList.js`

5. 安装并部署`cloudfunctions/`下的云函数。
6. 按源码引用创建云数据库集合、导入相应数据，并配置访问权限。
7. 在微信开发者工具中编译和预览。

> `uploadCloudFunction.bat`包含原开发机器的路径和环境参数，换电脑后需要先修改。

## 使用方法

- **单词背诵**：选择JLPT等级并开始单词学习
- **语法学习**：浏览语法、集中复习或查看收藏
- **听力口语**：进行听力和跟读练习
- **我的**：登录并查看学习进度、JLPT工具和排行榜

部分学习记录和收藏功能需要登录后使用，因为数据会保存到云开发环境。

## 注意事项

- 当前小程序界面以中文为主。
- 云环境ID、数据库内容及权限需要按照自己的部署环境配置。
- 仓库目前没有独立的许可证文件。
