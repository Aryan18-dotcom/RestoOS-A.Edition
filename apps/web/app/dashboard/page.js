import Shell from "../../components/Shell";
import RestaurantOperations from "../../components/RestaurantOperations";

export default function Dashboard() {
  return <Shell title="Owner ERP · Live operations"><RestaurantOperations mode="owner"/></Shell>;
}
